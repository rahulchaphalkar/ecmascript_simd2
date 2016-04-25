/*
  vim: set ts=8 sts=2 et sw=2 tw=79:
  Copyright (C) 2013

  This software is provided 'as-is', without any express or implied
  warranty.  In no event will the authors be held liable for any damages
  arising from the use of this software.

  Permission is granted to anyone to use this software for any purpose,
  including commercial applications, and to alter it and redistribute it
  freely, subject to the following restrictions:

  1. The origin of this software must not be misrepresented; you must not
     claim that you wrote the original software. If you use this software
     in a product, an acknowledgment in the product documentation would be
     appreciated but is not required.
  2. Altered source versions must be plainly marked as such, and must not be
     misrepresented as being the original software.
  3. This notice may not be removed or altered from any source distribution.
*/

// A conforming SIMD.js implementation may contain the following deviations to
// normal JS numeric behavior:
//  - Subnormal numbers may or may not be flushed to zero on input or output of
//    any SIMD operation.

// Many of the operations in SIMD.js have semantics which correspond to scalar
// operations in JS, however there are a few differences:
//  - Vector shifts don't mask the shift count.
//  - Conversions from float to int32 throw on error.
//  - Load and store operations throw when out of bounds.




// The Module object: Our interface to the outside world. We import
// and export values on it, and do the work to get that through
// closure compiler if necessary. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to do an eval in order to handle the closure compiler
// case, where this code here is minified but Module was defined
// elsewhere (e.g. case 4 above). We also need to check if Module
// already exists (e.g. case 3 above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module;
if (!Module) Module = (typeof Module !== 'undefined' ? Module : null) || {};

// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
for (var key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}

// The environment setup code below is customized to use Module.
// *** Environment setup code ***
var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_WORKER = false;
var ENVIRONMENT_IS_NODE = false;
var ENVIRONMENT_IS_SHELL = false;

// Three configurations we can be running in:
// 1) We could be the application main() thread running in the main JS UI thread. (ENVIRONMENT_IS_WORKER == false and ENVIRONMENT_IS_PTHREAD == false)
// 2) We could be the application main() thread proxied to worker. (with Emscripten -s PROXY_TO_WORKER=1) (ENVIRONMENT_IS_WORKER == true, ENVIRONMENT_IS_PTHREAD == false)
// 3) We could be an application pthread running in a worker. (ENVIRONMENT_IS_WORKER == true and ENVIRONMENT_IS_PTHREAD == true)

if (Module['ENVIRONMENT']) {
  if (Module['ENVIRONMENT'] === 'WEB') {
    ENVIRONMENT_IS_WEB = true;
  } else if (Module['ENVIRONMENT'] === 'WORKER') {
    ENVIRONMENT_IS_WORKER = true;
  } else if (Module['ENVIRONMENT'] === 'NODE') {
    ENVIRONMENT_IS_NODE = true;
  } else if (Module['ENVIRONMENT'] === 'SHELL') {
    ENVIRONMENT_IS_SHELL = true;
  } else {
    throw new Error('The provided Module[\'ENVIRONMENT\'] value is not valid. It must be one of: WEB|WORKER|NODE|SHELL.');
  }
} else {
  ENVIRONMENT_IS_WEB = typeof window === 'object';
  ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
  ENVIRONMENT_IS_NODE = typeof process === 'object' && typeof require === 'function' && !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_WORKER;
  ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;
}


if (ENVIRONMENT_IS_NODE) {
  // Expose functionality in the same simple way that the shells work
  // Note that we pollute the global namespace here, otherwise we break in node
  if (!Module['print']) Module['print'] = console.log;
  if (!Module['printErr']) Module['printErr'] = console.warn;

  var nodeFS;
  var nodePath;

  Module['read'] = function read(filename, binary) {
    if (!nodeFS) nodeFS = require('fs');
    if (!nodePath) nodePath = require('path');

    filename = nodePath['normalize'](filename);
    var ret = nodeFS['readFileSync'](filename);
    // The path is absolute if the normalized version is the same as the resolved.
    if (!ret && filename != nodePath['resolve'](filename)) {
      filename = path.join(__dirname, '..', 'src', filename);
      ret = nodeFS['readFileSync'](filename);
    }
    if (ret && !binary) ret = ret.toString();
    return ret;
  };

  Module['readBinary'] = function readBinary(filename) {
    var ret = Module['read'](filename, true);
    if (!ret.buffer) {
      ret = new Uint8Array(ret);
    }
    assert(ret.buffer);
    return ret;
  };

  Module['load'] = function load(f) {
    globalEval(read(f));
  };

  if (!Module['thisProgram']) {
    if (process['argv'].length > 1) {
      Module['thisProgram'] = process['argv'][1].replace(/\\/g, '/');
    } else {
      Module['thisProgram'] = 'unknown-program';
    }
  }

  Module['arguments'] = process['argv'].slice(2);

  if (typeof module !== 'undefined') {
    module['exports'] = Module;
  }

  process['on']('uncaughtException', function(ex) {
    // suppress ExitStatus exceptions from showing an error
    if (!(ex instanceof ExitStatus)) {
      throw ex;
    }
  });

  Module['inspect'] = function () { return '[Emscripten Module object]'; };
}
else if (ENVIRONMENT_IS_SHELL) {
  if (!Module['print']) Module['print'] = print;
  if (typeof printErr != 'undefined') Module['printErr'] = printErr; // not present in v8 or older sm

  if (typeof read != 'undefined') {
    Module['read'] = read;
  } else {
    Module['read'] = function read() { throw 'no read() available (jsc?)' };
  }

  Module['readBinary'] = function readBinary(f) {
    if (typeof readbuffer === 'function') {
      return new Uint8Array(readbuffer(f));
    }
    var data = read(f, 'binary');
    assert(typeof data === 'object');
    return data;
  };

  if (typeof scriptArgs != 'undefined') {
    Module['arguments'] = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    Module['arguments'] = arguments;
  }

}
else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  Module['read'] = function read(url) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send(null);
    return xhr.responseText;
  };

  Module['readAsync'] = function readAsync(url, onload, onerror) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function xhr_onload() {
      if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
        onload(xhr.response);
      } else {
        onerror();
      }
    };
    xhr.onerror = onerror;
    xhr.send(null);
  };

  if (typeof arguments != 'undefined') {
    Module['arguments'] = arguments;
  }

  if (typeof console !== 'undefined') {
    if (!Module['print']) Module['print'] = function print(x) {
      console.log(x);
    };
    if (!Module['printErr']) Module['printErr'] = function printErr(x) {
      console.warn(x);
    };
  } else {
    // Probably a worker, and without console.log. We can do very little here...
    var TRY_USE_DUMP = false;
    if (!Module['print']) Module['print'] = (TRY_USE_DUMP && (typeof(dump) !== "undefined") ? (function(x) {
      dump(x);
    }) : (function(x) {
      // self.postMessage(x); // enable this if you want stdout to be sent as messages
    }));
  }

  if (ENVIRONMENT_IS_WORKER) {
    Module['load'] = importScripts;
  }

  if (typeof Module['setWindowTitle'] === 'undefined') {
    Module['setWindowTitle'] = function(title) { document.title = title };
  }
}
else {
  // Unreachable because SHELL is dependant on the others
  throw 'Unknown runtime environment. Where are we?';
}

function globalEval(x) {
  eval.call(null, x);
}
if (!Module['load'] && Module['read']) {
  Module['load'] = function load(f) {
    globalEval(Module['read'](f));
  };
}
if (!Module['print']) {
  Module['print'] = function(){};
}
if (!Module['printErr']) {
  Module['printErr'] = Module['print'];
}
if (!Module['arguments']) {
  Module['arguments'] = [];
}
if (!Module['thisProgram']) {
  Module['thisProgram'] = './this.program';
}

// *** Environment setup code ***

// Closure helpers
Module.print = Module['print'];
Module.printErr = Module['printErr'];

// Callbacks
Module['preRun'] = [];
Module['postRun'] = [];

// Merge back in the overrides
for (var key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used e.g. in memoryInitializerRequest, which is a large typed array.
moduleOverrides = undefined;



// {{PREAMBLE_ADDITIONS}}

// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in: 
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at: 
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html

//========================================
// Runtime code shared with compiler
//========================================

var Runtime = {
  setTempRet0: function (value) {
    tempRet0 = value;
  },
  getTempRet0: function () {
    return tempRet0;
  },
  stackSave: function () {
    return STACKTOP;
  },
  stackRestore: function (stackTop) {
    STACKTOP = stackTop;
  },
  getNativeTypeSize: function (type) {
    switch (type) {
      case 'i1': case 'i8': return 1;
      case 'i16': return 2;
      case 'i32': return 4;
      case 'i64': return 8;
      case 'float': return 4;
      case 'double': return 8;
      default: {
        if (type[type.length-1] === '*') {
          return Runtime.QUANTUM_SIZE; // A pointer
        } else if (type[0] === 'i') {
          var bits = parseInt(type.substr(1));
          assert(bits % 8 === 0);
          return bits/8;
        } else {
          return 0;
        }
      }
    }
  },
  getNativeFieldSize: function (type) {
    return Math.max(Runtime.getNativeTypeSize(type), Runtime.QUANTUM_SIZE);
  },
  STACK_ALIGN: 16,
  prepVararg: function (ptr, type) {
    if (type === 'double' || type === 'i64') {
      // move so the load is aligned
      if (ptr & 7) {
        assert((ptr & 7) === 4);
        ptr += 4;
      }
    } else {
      assert((ptr & 3) === 0);
    }
    return ptr;
  },
  getAlignSize: function (type, size, vararg) {
    // we align i64s and doubles on 64-bit boundaries, unlike x86
    if (!vararg && (type == 'i64' || type == 'double')) return 8;
    if (!type) return Math.min(size, 8); // align structures internally to 64 bits
    return Math.min(size || (type ? Runtime.getNativeFieldSize(type) : 0), Runtime.QUANTUM_SIZE);
  },
  dynCall: function (sig, ptr, args) {
    if (args && args.length) {
      if (!args.splice) args = Array.prototype.slice.call(args);
      args.splice(0, 0, ptr);
      return Module['dynCall_' + sig].apply(null, args);
    } else {
      return Module['dynCall_' + sig].call(null, ptr);
    }
  },
  functionPointers: [],
  addFunction: function (func) {
    for (var i = 0; i < Runtime.functionPointers.length; i++) {
      if (!Runtime.functionPointers[i]) {
        Runtime.functionPointers[i] = func;
        return 2*(1 + i);
      }
    }
    throw 'Finished up all reserved function pointers. Use a higher value for RESERVED_FUNCTION_POINTERS.';
  },
  removeFunction: function (index) {
    Runtime.functionPointers[(index-2)/2] = null;
  },
  warnOnce: function (text) {
    if (!Runtime.warnOnce.shown) Runtime.warnOnce.shown = {};
    if (!Runtime.warnOnce.shown[text]) {
      Runtime.warnOnce.shown[text] = 1;
      Module.printErr(text);
    }
  },
  funcWrappers: {},
  getFuncWrapper: function (func, sig) {
    assert(sig);
    if (!Runtime.funcWrappers[sig]) {
      Runtime.funcWrappers[sig] = {};
    }
    var sigCache = Runtime.funcWrappers[sig];
    if (!sigCache[func]) {
      sigCache[func] = function dynCall_wrapper() {
        return Runtime.dynCall(sig, func, arguments);
      };
    }
    return sigCache[func];
  },
  getCompilerSetting: function (name) {
    throw 'You must build with -s RETAIN_COMPILER_SETTINGS=1 for Runtime.getCompilerSetting or emscripten_get_compiler_setting to work';
  },
  stackAlloc: function (size) { var ret = STACKTOP;STACKTOP = (STACKTOP + size)|0;STACKTOP = (((STACKTOP)+15)&-16); return ret; },
  staticAlloc: function (size) { var ret = STATICTOP;STATICTOP = (STATICTOP + size)|0;STATICTOP = (((STATICTOP)+15)&-16); return ret; },
  dynamicAlloc: function (size) { var ret = DYNAMICTOP;DYNAMICTOP = (DYNAMICTOP + size)|0;DYNAMICTOP = (((DYNAMICTOP)+15)&-16); if (DYNAMICTOP >= TOTAL_MEMORY) { var success = enlargeMemory(); if (!success) { DYNAMICTOP = ret;  return 0; } }; return ret; },
  alignMemory: function (size,quantum) { var ret = size = Math.ceil((size)/(quantum ? quantum : 16))*(quantum ? quantum : 16); return ret; },
  makeBigInt: function (low,high,unsigned) { var ret = (unsigned ? ((+((low>>>0)))+((+((high>>>0)))*4294967296.0)) : ((+((low>>>0)))+((+((high|0)))*4294967296.0))); return ret; },
  GLOBAL_BASE: 8,
  QUANTUM_SIZE: 4,
  __dummy__: 0
}



Module["Runtime"] = Runtime;



//========================================
// Runtime essentials
//========================================

var ABORT = false; // whether we are quitting the application. no code should run after this. set in exit() and abort()
var EXITSTATUS = 0;

function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}

var globalScope = this;

// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  var func = Module['_' + ident]; // closure exported function
  if (!func) {
    try { func = eval('_' + ident); } catch(e) {}
  }
  assert(func, 'Cannot call unknown function ' + ident + ' (perhaps LLVM optimizations or closure removed it?)');
  return func;
}

var cwrap, ccall;
(function(){
  var JSfuncs = {
    // Helpers for cwrap -- it can't refer to Runtime directly because it might
    // be renamed by closure, instead it calls JSfuncs['stackSave'].body to find
    // out what the minified function name is.
    'stackSave': function() {
      Runtime.stackSave()
    },
    'stackRestore': function() {
      Runtime.stackRestore()
    },
    // type conversion from js to c
    'arrayToC' : function(arr) {
      var ret = Runtime.stackAlloc(arr.length);
      writeArrayToMemory(arr, ret);
      return ret;
    },
    'stringToC' : function(str) {
      var ret = 0;
      if (str !== null && str !== undefined && str !== 0) { // null string
        // at most 4 bytes per UTF-8 code point, +1 for the trailing '\0'
        ret = Runtime.stackAlloc((str.length << 2) + 1);
        writeStringToMemory(str, ret);
      }
      return ret;
    }
  };
  // For fast lookup of conversion functions
  var toC = {'string' : JSfuncs['stringToC'], 'array' : JSfuncs['arrayToC']};

  // C calling interface. 
  ccall = function ccallFunc(ident, returnType, argTypes, args, opts) {
    var func = getCFunc(ident);
    var cArgs = [];
    var stack = 0;
    if (args) {
      for (var i = 0; i < args.length; i++) {
        var converter = toC[argTypes[i]];
        if (converter) {
          if (stack === 0) stack = Runtime.stackSave();
          cArgs[i] = converter(args[i]);
        } else {
          cArgs[i] = args[i];
        }
      }
    }
    var ret = func.apply(null, cArgs);
    if (returnType === 'string') ret = Pointer_stringify(ret);
    if (stack !== 0) {
      if (opts && opts.async) {
        EmterpreterAsync.asyncFinalizers.push(function() {
          Runtime.stackRestore(stack);
        });
        return;
      }
      Runtime.stackRestore(stack);
    }
    return ret;
  }

  var sourceRegex = /^function\s*[a-zA-Z$_0-9]*\s*\(([^)]*)\)\s*{\s*([^*]*?)[\s;]*(?:return\s*(.*?)[;\s]*)?}$/;
  function parseJSFunc(jsfunc) {
    // Match the body and the return value of a javascript function source
    var parsed = jsfunc.toString().match(sourceRegex).slice(1);
    return {arguments : parsed[0], body : parsed[1], returnValue: parsed[2]}
  }

  // sources of useful functions. we create this lazily as it can trigger a source decompression on this entire file
  var JSsource = null;
  function ensureJSsource() {
    if (!JSsource) {
      JSsource = {};
      for (var fun in JSfuncs) {
        if (JSfuncs.hasOwnProperty(fun)) {
          // Elements of toCsource are arrays of three items:
          // the code, and the return value
          JSsource[fun] = parseJSFunc(JSfuncs[fun]);
        }
      }
    }
  }
  
  cwrap = function cwrap(ident, returnType, argTypes) {
    argTypes = argTypes || [];
    var cfunc = getCFunc(ident);
    // When the function takes numbers and returns a number, we can just return
    // the original function
    var numericArgs = argTypes.every(function(type){ return type === 'number'});
    var numericRet = (returnType !== 'string');
    if ( numericRet && numericArgs) {
      return cfunc;
    }
    // Creation of the arguments list (["$1","$2",...,"$nargs"])
    var argNames = argTypes.map(function(x,i){return '$'+i});
    var funcstr = "(function(" + argNames.join(',') + ") {";
    var nargs = argTypes.length;
    if (!numericArgs) {
      // Generate the code needed to convert the arguments from javascript
      // values to pointers
      ensureJSsource();
      funcstr += 'var stack = ' + JSsource['stackSave'].body + ';';
      for (var i = 0; i < nargs; i++) {
        var arg = argNames[i], type = argTypes[i];
        if (type === 'number') continue;
        var convertCode = JSsource[type + 'ToC']; // [code, return]
        funcstr += 'var ' + convertCode.arguments + ' = ' + arg + ';';
        funcstr += convertCode.body + ';';
        funcstr += arg + '=(' + convertCode.returnValue + ');';
      }
    }

    // When the code is compressed, the name of cfunc is not literally 'cfunc' anymore
    var cfuncname = parseJSFunc(function(){return cfunc}).returnValue;
    // Call the function
    funcstr += 'var ret = ' + cfuncname + '(' + argNames.join(',') + ');';
    if (!numericRet) { // Return type can only by 'string' or 'number'
      // Convert the result to a string
      var strgfy = parseJSFunc(function(){return Pointer_stringify}).returnValue;
      funcstr += 'ret = ' + strgfy + '(ret);';
    }
    if (!numericArgs) {
      // If we had a stack, restore it
      ensureJSsource();
      funcstr += JSsource['stackRestore'].body.replace('()', '(stack)') + ';';
    }
    funcstr += 'return ret})';
    return eval(funcstr);
  };
})();
Module["ccall"] = ccall;
Module["cwrap"] = cwrap;

function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[((ptr)>>0)]=value; break;
      case 'i8': HEAP8[((ptr)>>0)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}
Module["setValue"] = setValue;


function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[((ptr)>>0)];
      case 'i8': return HEAP8[((ptr)>>0)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for setValue: ' + type);
    }
  return null;
}
Module["getValue"] = getValue;

var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_STATIC = 2; // Cannot be freed
var ALLOC_DYNAMIC = 3; // Cannot be freed except through sbrk
var ALLOC_NONE = 4; // Do not allocate
Module["ALLOC_NORMAL"] = ALLOC_NORMAL;
Module["ALLOC_STACK"] = ALLOC_STACK;
Module["ALLOC_STATIC"] = ALLOC_STATIC;
Module["ALLOC_DYNAMIC"] = ALLOC_DYNAMIC;
Module["ALLOC_NONE"] = ALLOC_NONE;

// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }

  var singleType = typeof types === 'string' ? types : null;

  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [typeof _malloc === 'function' ? _malloc : Runtime.staticAlloc, Runtime.stackAlloc, Runtime.staticAlloc, Runtime.dynamicAlloc][allocator === undefined ? ALLOC_STATIC : allocator](Math.max(size, singleType ? 1 : types.length));
  }

  if (zeroinit) {
    var ptr = ret, stop;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)>>0)]=0;
    }
    return ret;
  }

  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(slab, ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }

  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];

    if (typeof curr === 'function') {
      curr = Runtime.getFunctionIndex(curr);
    }

    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }

    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later

    setValue(ret+i, curr, type);

    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = Runtime.getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }

  return ret;
}
Module["allocate"] = allocate;

// Allocate memory during any stage of startup - static memory early on, dynamic memory later, malloc when ready
function getMemory(size) {
  if (!staticSealed) return Runtime.staticAlloc(size);
  if ((typeof _sbrk !== 'undefined' && !_sbrk.called) || !runtimeInitialized) return Runtime.dynamicAlloc(size);
  return _malloc(size);
}
Module["getMemory"] = getMemory;

function Pointer_stringify(ptr, /* optional */ length) {
  if (length === 0 || !ptr) return '';
  // TODO: use TextDecoder
  // Find the length, and check for UTF while doing so
  var hasUtf = 0;
  var t;
  var i = 0;
  while (1) {
    t = HEAPU8[(((ptr)+(i))>>0)];
    hasUtf |= t;
    if (t == 0 && !length) break;
    i++;
    if (length && i == length) break;
  }
  if (!length) length = i;

  var ret = '';

  if (hasUtf < 128) {
    var MAX_CHUNK = 1024; // split up into chunks, because .apply on a huge string can overflow the stack
    var curr;
    while (length > 0) {
      curr = String.fromCharCode.apply(String, HEAPU8.subarray(ptr, ptr + Math.min(length, MAX_CHUNK)));
      ret = ret ? ret + curr : curr;
      ptr += MAX_CHUNK;
      length -= MAX_CHUNK;
    }
    return ret;
  }
  return Module['UTF8ToString'](ptr);
}
Module["Pointer_stringify"] = Pointer_stringify;

// Given a pointer 'ptr' to a null-terminated ASCII-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function AsciiToString(ptr) {
  var str = '';
  while (1) {
    var ch = HEAP8[((ptr++)>>0)];
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
}
Module["AsciiToString"] = AsciiToString;

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in ASCII form. The copy will require at most str.length+1 bytes of space in the HEAP.

function stringToAscii(str, outPtr) {
  return writeAsciiToMemory(str, outPtr, false);
}
Module["stringToAscii"] = stringToAscii;

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

function UTF8ArrayToString(u8Array, idx) {
  var u0, u1, u2, u3, u4, u5;

  var str = '';
  while (1) {
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    u0 = u8Array[idx++];
    if (!u0) return str;
    if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
    u1 = u8Array[idx++] & 63;
    if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
    u2 = u8Array[idx++] & 63;
    if ((u0 & 0xF0) == 0xE0) {
      u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
    } else {
      u3 = u8Array[idx++] & 63;
      if ((u0 & 0xF8) == 0xF0) {
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | u3;
      } else {
        u4 = u8Array[idx++] & 63;
        if ((u0 & 0xFC) == 0xF8) {
          u0 = ((u0 & 3) << 24) | (u1 << 18) | (u2 << 12) | (u3 << 6) | u4;
        } else {
          u5 = u8Array[idx++] & 63;
          u0 = ((u0 & 1) << 30) | (u1 << 24) | (u2 << 18) | (u3 << 12) | (u4 << 6) | u5;
        }
      }
    }
    if (u0 < 0x10000) {
      str += String.fromCharCode(u0);
    } else {
      var ch = u0 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    }
  }
}
Module["UTF8ArrayToString"] = UTF8ArrayToString;

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function UTF8ToString(ptr) {
  return UTF8ArrayToString(HEAPU8,ptr);
}
Module["UTF8ToString"] = UTF8ToString;

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null 
//                    terminator, i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0x1FFFFF) {
      if (outIdx + 3 >= endIdx) break;
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0x3FFFFFF) {
      if (outIdx + 4 >= endIdx) break;
      outU8Array[outIdx++] = 0xF8 | (u >> 24);
      outU8Array[outIdx++] = 0x80 | ((u >> 18) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 5 >= endIdx) break;
      outU8Array[outIdx++] = 0xFC | (u >> 30);
      outU8Array[outIdx++] = 0x80 | ((u >> 24) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 18) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}
Module["stringToUTF8Array"] = stringToUTF8Array;

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}
Module["stringToUTF8"] = stringToUTF8;

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) {
      ++len;
    } else if (u <= 0x7FF) {
      len += 2;
    } else if (u <= 0xFFFF) {
      len += 3;
    } else if (u <= 0x1FFFFF) {
      len += 4;
    } else if (u <= 0x3FFFFFF) {
      len += 5;
    } else {
      len += 6;
    }
  }
  return len;
}
Module["lengthBytesUTF8"] = lengthBytesUTF8;

// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function UTF16ToString(ptr) {
  var i = 0;

  var str = '';
  while (1) {
    var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
    if (codeUnit == 0)
      return str;
    ++i;
    // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
    str += String.fromCharCode(codeUnit);
  }
}


// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16 form. The copy will require at most str.length*4+2 bytes of space in the HEAP.
// Use the function lengthBytesUTF16() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null 
//                    terminator, i.e. if maxBytesToWrite=2, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<2 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF16(str, outPtr, maxBytesToWrite) {
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2; // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length*2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[((outPtr)>>1)]=codeUnit;
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[((outPtr)>>1)]=0;
  return outPtr - startPtr;
}


// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF16(str) {
  return str.length*2;
}


function UTF32ToString(ptr) {
  var i = 0;

  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}


// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32 form. The copy will require at most str.length*4+4 bytes of space in the HEAP.
// Use the function lengthBytesUTF32() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null 
//                    terminator, i.e. if maxBytesToWrite=4, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<4 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF32(str, outPtr, maxBytesToWrite) {
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 4) return 0;
  var startPtr = outPtr;
  var endPtr = startPtr + maxBytesToWrite - 4;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++i);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[((outPtr)>>2)]=codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[((outPtr)>>2)]=0;
  return outPtr - startPtr;
}


// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF32(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) ++i; // possibly a lead surrogate, so skip over the tail surrogate.
    len += 4;
  }

  return len;
}


function demangle(func) {
  var hasLibcxxabi = !!Module['___cxa_demangle'];
  if (hasLibcxxabi) {
    try {
      var buf = _malloc(func.length);
      writeStringToMemory(func.substr(1), buf);
      var status = _malloc(4);
      var ret = Module['___cxa_demangle'](buf, 0, 0, status);
      if (getValue(status, 'i32') === 0 && ret) {
        return Pointer_stringify(ret);
      }
      // otherwise, libcxxabi failed, we can try ours which may return a partial result
    } catch(e) {
      // failure when using libcxxabi, we can try ours which may return a partial result
      return func;
    } finally {
      if (buf) _free(buf);
      if (status) _free(status);
      if (ret) _free(ret);
    }
  }
  Runtime.warnOnce('warning: build with  -s DEMANGLE_SUPPORT=1  to link in libcxxabi demangling');
  return func;
}

function demangleAll(text) {
  return text.replace(/__Z[\w\d_]+/g, function(x) { var y = demangle(x); return x === y ? x : (x + ' [' + y + ']') });
}

function jsStackTrace() {
  var err = new Error();
  if (!err.stack) {
    // IE10+ special cases: It does have callstack info, but it is only populated if an Error object is thrown,
    // so try that as a special-case.
    try {
      throw new Error(0);
    } catch(e) {
      err = e;
    }
    if (!err.stack) {
      return '(no stack trace available)';
    }
  }
  return err.stack.toString();
}

function stackTrace() {
  return demangleAll(jsStackTrace());
}
Module["stackTrace"] = stackTrace;

// Memory management

var PAGE_SIZE = 4096;

function alignMemoryPage(x) {
  if (x % 4096 > 0) {
    x += (4096 - (x % 4096));
  }
  return x;
}

var HEAP;
var buffer;
var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;

function updateGlobalBuffer(buf) {
  Module['buffer'] = buffer = buf;
}

function updateGlobalBufferViews() {
  Module['HEAP8'] = HEAP8 = new Int8Array(buffer);
  Module['HEAP16'] = HEAP16 = new Int16Array(buffer);
  Module['HEAP32'] = HEAP32 = new Int32Array(buffer);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(buffer);
  Module['HEAPU16'] = HEAPU16 = new Uint16Array(buffer);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(buffer);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(buffer);
  Module['HEAPF64'] = HEAPF64 = new Float64Array(buffer);
}

var STATIC_BASE = 0, STATICTOP = 0, staticSealed = false; // static area
var STACK_BASE = 0, STACKTOP = 0, STACK_MAX = 0; // stack area
var DYNAMIC_BASE = 0, DYNAMICTOP = 0; // dynamic area handled by sbrk


function abortOnCannotGrowMemory() {
  abort('Cannot enlarge memory arrays. Either (1) compile with  -s TOTAL_MEMORY=X  with X higher than the current value ' + TOTAL_MEMORY + ', (2) compile with  -s ALLOW_MEMORY_GROWTH=1  which adjusts the size at runtime but prevents some optimizations, (3) set Module.TOTAL_MEMORY to a higher value before the program runs, or if you want malloc to return NULL (0) instead of this abort, compile with  -s ABORTING_MALLOC=0 ');
}

function enlargeMemory() {
  abortOnCannotGrowMemory();
}


var TOTAL_STACK = Module['TOTAL_STACK'] || 5242880;
var TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;

var totalMemory = 64*1024;
while (totalMemory < TOTAL_MEMORY || totalMemory < 2*TOTAL_STACK) {
  if (totalMemory < 16*1024*1024) {
    totalMemory *= 2;
  } else {
    totalMemory += 16*1024*1024
  }
}
if (totalMemory !== TOTAL_MEMORY) {
  TOTAL_MEMORY = totalMemory;
}

// Initialize the runtime's memory



// Use a provided buffer, if there is one, or else allocate a new one
if (Module['buffer']) {
  buffer = Module['buffer'];
} else {
  buffer = new ArrayBuffer(TOTAL_MEMORY);
}
updateGlobalBufferViews();


// Endianness check (note: assumes compiler arch was little-endian)
HEAP32[0] = 255;
if (HEAPU8[0] !== 255 || HEAPU8[3] !== 0) throw 'Typed arrays 2 must be run on a little-endian system';

Module['HEAP'] = HEAP;
Module['buffer'] = buffer;
Module['HEAP8'] = HEAP8;
Module['HEAP16'] = HEAP16;
Module['HEAP32'] = HEAP32;
Module['HEAPU8'] = HEAPU8;
Module['HEAPU16'] = HEAPU16;
Module['HEAPU32'] = HEAPU32;
Module['HEAPF32'] = HEAPF32;
Module['HEAPF64'] = HEAPF64;

function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Runtime.dynCall('v', func);
      } else {
        Runtime.dynCall('vi', func, [callback.arg]);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}

var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the runtime has exited

var runtimeInitialized = false;
var runtimeExited = false;


function preRun() {
  // compatibility - merge in anything from Module['preRun'] at this time
  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPRERUN__);
}

function ensureInitRuntime() {
  if (runtimeInitialized) return;
  runtimeInitialized = true;
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  callRuntimeCallbacks(__ATEXIT__);
  runtimeExited = true;
}

function postRun() {
  // compatibility - merge in anything from Module['postRun'] at this time
  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}
Module["addOnPreRun"] = addOnPreRun;

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}
Module["addOnInit"] = addOnInit;

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}
Module["addOnPreMain"] = addOnPreMain;

function addOnExit(cb) {
  __ATEXIT__.unshift(cb);
}
Module["addOnExit"] = addOnExit;

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}
Module["addOnPostRun"] = addOnPostRun;

// Tools


function intArrayFromString(stringy, dontAddNull, length /* optional */) {
  var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
  var u8array = new Array(len);
  var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
}
Module["intArrayFromString"] = intArrayFromString;

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}
Module["intArrayToString"] = intArrayToString;

function writeStringToMemory(string, buffer, dontAddNull) {
  var array = intArrayFromString(string, dontAddNull);
  var i = 0;
  while (i < array.length) {
    var chr = array[i];
    HEAP8[(((buffer)+(i))>>0)]=chr;
    i = i + 1;
  }
}
Module["writeStringToMemory"] = writeStringToMemory;

function writeArrayToMemory(array, buffer) {
  for (var i = 0; i < array.length; i++) {
    HEAP8[((buffer++)>>0)]=array[i];
  }
}
Module["writeArrayToMemory"] = writeArrayToMemory;

function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; ++i) {
    HEAP8[((buffer++)>>0)]=str.charCodeAt(i);
  }
  // Null-terminate the pointer to the HEAP.
  if (!dontAddNull) HEAP8[((buffer)>>0)]=0;
}
Module["writeAsciiToMemory"] = writeAsciiToMemory;

function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}


// check for imul support, and also for correctness ( https://bugs.webkit.org/show_bug.cgi?id=126345 )
if (!Math['imul'] || Math['imul'](0xffffffff, 5) !== -5) Math['imul'] = function imul(a, b) {
  var ah  = a >>> 16;
  var al = a & 0xffff;
  var bh  = b >>> 16;
  var bl = b & 0xffff;
  return (al*bl + ((ah*bl + al*bh) << 16))|0;
};
Math.imul = Math['imul'];

if (!Math['fround']) Math['fround'] = function(x) { return x };

if (!Math['clz32']) Math['clz32'] = function(x) {
  x = x >>> 0;
  for (var i = 0; i < 32; i++) {
    if (x & (1 << (31 - i))) return i;
  }
  return 32;
};
Math.clz32 = Math['clz32']

var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_min = Math.min;
var Math_clz32 = Math.clz32;

// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// PRE_RUN_ADDITIONS (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled

function getUniqueRunDependency(id) {
  return id;
}

function addRunDependency(id) {
  runDependencies++;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
}
Module["addRunDependency"] = addRunDependency;

function removeRunDependency(id) {
  runDependencies--;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}
Module["removeRunDependency"] = removeRunDependency;

Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data



var memoryInitializer = null;




// === Body ===

var ASM_CONSTS = [];




STATIC_BASE = 8;

STATICTOP = STATIC_BASE + 45776;
  /* global initializers */  __ATINIT__.push({ func: function() { __GLOBAL__sub_I_base_cpp() } });
  

/* memory initializer */ allocate([224,1,0,0,98,14,0,0,8,2,0,0,64,14,0,0,48,0,0,0,0,0,0,0,8,2,0,0,237,13,0,0,16,0,0,0,0,0,0,0,8,2,0,0,18,14,0,0,64,0,0,0,0,0,0,0,224,1,0,0,51,14,0,0,8,2,0,0,40,15,0,0,8,0,0,0,0,0,0,0,8,2,0,0,104,15,0,0,48,0,0,0,0,0,0,0,8,2,0,0,68,15,0,0,88,0,0,0,0,0,0,0,124,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,2,0,0,0,188,174,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,255,255,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,240,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,2,0,0,0,196,174,0,0,0,4,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,10,255,255,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,240,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,255,255,255,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,16,0,0,0,1,0,0,0,2,0,0,0,3,0,0,0,4,0,0,0,5,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,32,0,0,0,1,0,0,0,5,0,0,0,3,0,0,0,4,0,0,0,5,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0,111,14,0,0,0,0,0,0,72,0,0,0,6,0,0,0,7,0,0,0,2,0,0,0,65,118,101,114,97,103,101,70,108,111,97,116,51,50,120,52,0,77,97,110,100,101,108,98,114,111,116,0,77,97,116,114,105,120,77,117,108,116,105,112,108,105,99,97,116,105,111,110,0,86,101,114,116,101,120,84,114,97,110,115,102,111,114,109,0,77,97,116,114,105,120,84,114,97,110,115,112,111,115,101,0,77,97,116,114,105,120,73,110,118,101,114,115,101,0,37,45,50,48,115,32,58,32,37,49,50,115,32,37,49,50,115,32,37,49,50,115,32,37,49,50,115,32,37,49,48,115,32,37,49,48,115,0,78,97,109,101,0,73,116,101,114,97,116,105,111,110,115,0,83,99,97,108,97,114,51,50,40,110,115,41,0,83,99,97,108,97,114,54,52,40,110,115,41,0,83,73,77,68,51,50,40,110,115,41,0,82,97,116,105,111,51,50,0,82,97,116,105,111,54,52,0,37,115,58,32,37,115,0,70,65,73,76,69,68,32,73,78,73,84,0,70,65,73,76,69,68,32,67,76,69,65,78,85,80,0,37,45,50,48,115,32,58,32,37,49,50,108,108,117,32,37,49,50,108,108,117,32,37,49,50,108,108,117,32,37,49,50,108,108,117,32,37,49,48,46,50,102,32,37,49,48,46,50,102,0,17,0,10,0,17,17,17,0,0,0,0,5,0,0,0,0,0,0,9,0,0,0,0,11,0,0,0,0,0,0,0,0,17,0,15,10,17,17,17,3,10,7,0,1,19,9,11,11,0,0,9,6,11,0,0,11,0,6,17,0,0,0,17,17,17,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,0,0,0,0,0,0,17,0,10,10,17,17,17,0,10,0,0,2,0,9,11,0,0,0,9,0,11,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,12,0,0,0,0,0,0,0,0,0,0,0,12,0,0,0,0,12,0,0,0,0,9,12,0,0,0,0,0,12,0,0,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,14,0,0,0,0,0,0,0,0,0,0,0,13,0,0,0,4,13,0,0,0,0,9,14,0,0,0,0,0,14,0,0,14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,16,0,0,0,0,0,0,0,0,0,0,0,15,0,0,0,0,15,0,0,0,0,9,16,0,0,0,0,0,16,0,0,16,0,0,18,0,0,0,18,18,18,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,18,0,0,0,18,18,18,0,0,0,0,0,0,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,0,0,0,0,0,0,0,0,0,10,0,0,0,0,10,0,0,0,0,9,11,0,0,0,0,0,11,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,12,0,0,0,0,0,0,0,0,0,0,0,12,0,0,0,0,12,0,0,0,0,9,12,0,0,0,0,0,12,0,0,12,0,0,48,49,50,51,52,53,54,55,56,57,65,66,67,68,69,70,45,43,32,32,32,48,88,48,120,0,84,33,34,25,13,1,2,3,17,75,28,12,16,4,11,29,18,30,39,104,110,111,112,113,98,32,5,6,15,19,20,21,26,8,22,7,40,36,23,24,9,10,14,27,31,37,35,131,130,125,38,42,43,60,61,62,63,67,71,74,77,88,89,90,91,92,93,94,95,96,97,99,100,101,102,103,105,106,107,108,114,115,116,121,122,123,124,0,73,108,108,101,103,97,108,32,98,121,116,101,32,115,101,113,117,101,110,99,101,0,68,111,109,97,105,110,32,101,114,114,111,114,0,82,101,115,117,108,116,32,110,111,116,32,114,101,112,114,101,115,101,110,116,97,98,108,101,0,78,111,116,32,97,32,116,116,121,0,80,101,114,109,105,115,115,105,111,110,32,100,101,110,105,101,100,0,79,112,101,114,97,116,105,111,110,32,110,111,116,32,112,101,114,109,105,116,116,101,100,0,78,111,32,115,117,99,104,32,102,105,108,101,32,111,114,32,100,105,114,101,99,116,111,114,121,0,78,111,32,115,117,99,104,32,112,114,111,99,101,115,115,0,70,105,108,101,32,101,120,105,115,116,115,0,86,97,108,117,101,32,116,111,111,32,108,97,114,103,101,32,102,111,114,32,100,97,116,97,32,116,121,112,101,0,78,111,32,115,112,97,99,101,32,108,101,102,116,32,111,110,32,100,101,118,105,99,101,0,79,117,116,32,111,102,32,109,101,109,111,114,121,0,82,101,115,111,117,114,99,101,32,98,117,115,121,0,73,110,116,101,114,114,117,112,116,101,100,32,115,121,115,116,101,109,32,99,97,108,108,0,82,101,115,111,117,114,99,101,32,116,101,109,112,111,114,97,114,105,108,121,32,117,110,97,118,97,105,108,97,98,108,101,0,73,110,118,97,108,105,100,32,115,101,101,107,0,67,114,111,115,115,45,100,101,118,105,99,101,32,108,105,110,107,0,82,101,97,100,45,111,110,108,121,32,102,105,108,101,32,115,121,115,116,101,109,0,68,105,114,101,99,116,111,114,121,32,110,111,116,32,101,109,112,116,121,0,67,111,110,110,101,99,116,105,111,110,32,114,101,115,101,116,32,98,121,32,112,101,101,114,0,79,112,101,114,97,116,105,111,110,32,116,105,109,101,100,32,111,117,116,0,67,111,110,110,101,99,116,105,111,110,32,114,101,102,117,115,101,100,0,72,111,115,116,32,105,115,32,100,111,119,110,0,72,111,115,116,32,105,115,32,117,110,114,101,97,99,104,97,98,108,101,0,65,100,100,114,101,115,115,32,105,110,32,117,115,101,0,66,114,111,107,101,110,32,112,105,112,101,0,73,47,79,32,101,114,114,111,114,0,78,111,32,115,117,99,104,32,100,101,118,105,99,101,32,111,114,32,97,100,100,114,101,115,115,0,66,108,111,99,107,32,100,101,118,105,99,101,32,114,101,113,117,105,114,101,100,0,78,111,32,115,117,99,104,32,100,101,118,105,99,101,0,78,111,116,32,97,32,100,105,114,101,99,116,111,114,121,0,73,115,32,97,32,100,105,114,101,99,116,111,114,121,0,84,101,120,116,32,102,105,108,101,32,98,117,115,121,0,69,120,101,99,32,102,111,114,109,97,116,32,101,114,114,111,114,0,73,110,118,97,108,105,100,32,97,114,103,117,109,101,110,116,0,65,114,103,117,109,101,110,116,32,108,105,115,116,32,116,111,111,32,108,111,110,103,0,83,121,109,98,111,108,105,99,32,108,105,110,107,32,108,111,111,112,0,70,105,108,101,110,97,109,101,32,116,111,111,32,108,111,110,103,0,84,111,111,32,109,97,110,121,32,111,112,101,110,32,102,105,108,101,115,32,105,110,32,115,121,115,116,101,109,0,78,111,32,102,105,108,101,32,100,101,115,99,114,105,112,116,111,114,115,32,97,118,97,105,108,97,98,108,101,0,66,97,100,32,102,105,108,101,32,100,101,115,99,114,105,112,116,111,114,0,78,111,32,99,104,105,108,100,32,112,114,111,99,101,115,115,0,66,97,100,32,97,100,100,114,101,115,115,0,70,105,108,101,32,116,111,111,32,108,97,114,103,101,0,84,111,111,32,109,97,110,121,32,108,105,110,107,115,0,78,111,32,108,111,99,107,115,32,97,118,97,105,108,97,98,108,101,0,82,101,115,111,117,114,99,101,32,100,101,97,100,108,111,99,107,32,119,111,117,108,100,32,111,99,99,117,114,0,83,116,97,116,101,32,110,111,116,32,114,101,99,111,118,101,114,97,98,108,101,0,80,114,101,118,105,111,117,115,32,111,119,110,101,114,32,100,105,101,100,0,79,112,101,114,97,116,105,111,110,32,99,97,110,99,101,108,101,100,0,70,117,110,99,116,105,111,110,32,110,111,116,32,105,109,112,108,101,109,101,110,116,101,100,0,78,111,32,109,101,115,115,97,103,101,32,111,102,32,100,101,115,105,114,101,100,32,116,121,112,101,0,73,100,101,110,116,105,102,105,101,114,32,114,101,109,111,118,101,100,0,68,101,118,105,99,101,32,110,111,116,32,97,32,115,116,114,101,97,109,0,78,111,32,100,97,116,97,32,97,118,97,105,108,97,98,108,101,0,68,101,118,105,99,101,32,116,105,109,101,111,117,116,0,79,117,116,32,111,102,32,115,116,114,101,97,109,115,32,114,101,115,111,117,114,99,101,115,0,76,105,110,107,32,104,97,115,32,98,101,101,110,32,115,101,118,101,114,101,100,0,80,114,111,116,111,99,111,108,32,101,114,114,111,114,0,66,97,100,32,109,101,115,115,97,103,101,0,70,105,108,101,32,100,101,115,99,114,105,112,116,111,114,32,105,110,32,98,97,100,32,115,116,97,116,101,0,78,111,116,32,97,32,115,111,99,107,101,116,0,68,101,115,116,105,110,97,116,105,111,110,32,97,100,100,114,101,115,115,32,114,101,113,117,105,114,101,100,0,77,101,115,115,97,103,101,32,116,111,111,32,108,97,114,103,101,0,80,114,111,116,111,99,111,108,32,119,114,111,110,103,32,116,121,112,101,32,102,111,114,32,115,111,99,107,101,116,0,80,114,111,116,111,99,111,108,32,110,111,116,32,97,118,97,105,108,97,98,108,101,0,80,114,111,116,111,99,111,108,32,110,111,116,32,115,117,112,112,111,114,116,101,100,0,83,111,99,107,101,116,32,116,121,112,101,32,110,111,116,32,115,117,112,112,111,114,116,101,100,0,78,111,116,32,115,117,112,112,111,114,116,101,100,0,80,114,111,116,111,99,111,108,32,102,97,109,105,108,121,32,110,111,116,32,115,117,112,112,111,114,116,101,100,0,65,100,100,114,101,115,115,32,102,97,109,105,108,121,32,110,111,116,32,115,117,112,112,111,114,116,101,100,32,98,121,32,112,114,111,116,111,99,111,108,0,65,100,100,114,101,115,115,32,110,111,116,32,97,118,97,105,108,97,98,108,101,0,78,101,116,119,111,114,107,32,105,115,32,100,111,119,110,0,78,101,116,119,111,114,107,32,117,110,114,101,97,99,104,97,98,108,101,0,67,111,110,110,101,99,116,105,111,110,32,114,101,115,101,116,32,98,121,32,110,101,116,119,111,114,107,0,67,111,110,110,101,99,116,105,111,110,32,97,98,111,114,116,101,100,0,78,111,32,98,117,102,102,101,114,32,115,112,97,99,101,32,97,118,97,105,108,97,98,108,101,0,83,111,99,107,101,116,32,105,115,32,99,111,110,110,101,99,116,101,100,0,83,111,99,107,101,116,32,110,111,116,32,99,111,110,110,101,99,116,101,100,0,67,97,110,110,111,116,32,115,101,110,100,32,97,102,116,101,114,32,115,111,99,107,101,116,32,115,104,117,116,100,111,119,110,0,79,112,101,114,97,116,105,111,110,32,97,108,114,101,97,100,121,32,105,110,32,112,114,111,103,114,101,115,115,0,79,112,101,114,97,116,105,111,110,32,105,110,32,112,114,111,103,114,101,115,115,0,83,116,97,108,101,32,102,105,108,101,32,104,97,110,100,108,101,0,82,101,109,111,116,101,32,73,47,79,32,101,114,114,111,114,0,81,117,111,116,97,32,101,120,99,101,101,100,101,100,0,78,111,32,109,101,100,105,117,109,32,102,111,117,110,100,0,87,114,111,110,103,32,109,101,100,105,117,109,32,116,121,112,101,0,78,111,32,101,114,114,111,114,32,105,110,102,111,114,109,97,116,105,111,110,0,0,40,110,117,108,108,41,0,45,48,88,43,48,88,32,48,88,45,48,120,43,48,120,32,48,120,0,105,110,102,0,73,78,70,0,110,97,110,0,78,65,78,0,46,0,33,34,98,97,115,105,99,95,115,116,114,105,110,103,32,108,101,110,103,116,104,95,101,114,114,111,114,34,0,67,58,92,80,114,111,103,114,97,109,32,70,105,108,101,115,92,69,109,115,99,114,105,112,116,101,110,92,101,109,115,99,114,105,112,116,101,110,92,109,97,115,116,101,114,92,115,121,115,116,101,109,92,105,110,99,108,117,100,101,92,108,105,98,99,120,120,92,115,116,114,105,110,103,0,95,95,116,104,114,111,119,95,108,101,110,103,116,104,95,101,114,114,111,114,0,99,97,110,110,111,116,32,122,101,114,111,32,111,117,116,32,116,104,114,101,97,100,32,118,97,108,117,101,32,102,111,114,32,95,95,99,120,97,95,103,101,116,95,103,108,111,98,97,108,115,40,41,0,99,97,110,110,111,116,32,99,114,101,97,116,101,32,112,116,104,114,101,97,100,32,107,101,121,32,102,111,114,32,95,95,99,120,97,95,103,101,116,95,103,108,111,98,97,108,115,40,41,0,112,116,104,114,101,97,100,95,111,110,99,101,32,102,97,105,108,117,114,101,32,105,110,32,95,95,99,120,97,95,103,101,116,95,103,108,111,98,97,108,115,95,102,97,115,116,40,41,0,78,49,48,95,95,99,120,120,97,98,105,118,49,50,48,95,95,115,105,95,99,108,97,115,115,95,116,121,112,101,95,105,110,102,111,69,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,54,95,95,115,104,105,109,95,116,121,112,101,95,105,110,102,111,69,0,83,116,57,116,121,112,101,95,105,110,102,111,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,55,95,95,99,108,97,115,115,95,116,121,112,101,95,105,110,102,111,69,0,83,116,57,101,120,99,101,112,116,105,111,110,0,117,110,99,97,117,103,104,116,0,116,101,114,109,105,110,97,116,105,110,103,32,119,105,116,104,32,37,115,32,101,120,99,101,112,116,105,111,110,32,111,102,32,116,121,112,101,32,37,115,58,32,37,115,0,116,101,114,109,105,110,97,116,105,110,103,32,119,105,116,104,32,37,115,32,101,120,99,101,112,116,105,111,110,32,111,102,32,116,121,112,101,32,37,115,0,116,101,114,109,105,110,97,116,105,110,103,32,119,105,116,104,32,37,115,32,102,111,114,101,105,103,110,32,101,120,99,101,112,116,105,111,110,0,116,101,114,109,105,110,97,116,105,110,103,0,116,101,114,109,105,110,97,116,101,95,104,97,110,100,108,101,114,32,117,110,101,120,112,101,99,116,101,100,108,121,32,114,101,116,117,114,110,101,100,0,83,116,57,98,97,100,95,97,108,108,111,99,0,115,116,100,58,58,98,97,100,95,97,108,108,111,99,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,57,95,95,112,111,105,110,116,101,114,95,116,121,112,101,95,105,110,102,111,69,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,55,95,95,112,98,97,115,101,95,116,121,112,101,95,105,110,102,111,69,0], "i8", ALLOC_NONE, Runtime.GLOBAL_BASE);





/* no memory initializer */
var tempDoublePtr = STATICTOP; STATICTOP += 16;

function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much

  HEAP8[tempDoublePtr] = HEAP8[ptr];

  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];

  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];

  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];

}

function copyTempDouble(ptr) {

  HEAP8[tempDoublePtr] = HEAP8[ptr];

  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];

  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];

  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];

  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];

  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];

  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];

  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];

}

// {{PRE_LIBRARY}}


  
  function _atexit(func, arg) {
      __ATEXIT__.unshift({ func: func, arg: arg });
    }function ___cxa_atexit() {
  return _atexit.apply(null, arguments)
  }

   
  Module["_i64Subtract"] = _i64Subtract;

  
  function ___setErrNo(value) {
      if (Module['___errno_location']) HEAP32[((Module['___errno_location']())>>2)]=value;
      return value;
    }
  
  var ERRNO_CODES={EPERM:1,ENOENT:2,ESRCH:3,EINTR:4,EIO:5,ENXIO:6,E2BIG:7,ENOEXEC:8,EBADF:9,ECHILD:10,EAGAIN:11,EWOULDBLOCK:11,ENOMEM:12,EACCES:13,EFAULT:14,ENOTBLK:15,EBUSY:16,EEXIST:17,EXDEV:18,ENODEV:19,ENOTDIR:20,EISDIR:21,EINVAL:22,ENFILE:23,EMFILE:24,ENOTTY:25,ETXTBSY:26,EFBIG:27,ENOSPC:28,ESPIPE:29,EROFS:30,EMLINK:31,EPIPE:32,EDOM:33,ERANGE:34,ENOMSG:42,EIDRM:43,ECHRNG:44,EL2NSYNC:45,EL3HLT:46,EL3RST:47,ELNRNG:48,EUNATCH:49,ENOCSI:50,EL2HLT:51,EDEADLK:35,ENOLCK:37,EBADE:52,EBADR:53,EXFULL:54,ENOANO:55,EBADRQC:56,EBADSLT:57,EDEADLOCK:35,EBFONT:59,ENOSTR:60,ENODATA:61,ETIME:62,ENOSR:63,ENONET:64,ENOPKG:65,EREMOTE:66,ENOLINK:67,EADV:68,ESRMNT:69,ECOMM:70,EPROTO:71,EMULTIHOP:72,EDOTDOT:73,EBADMSG:74,ENOTUNIQ:76,EBADFD:77,EREMCHG:78,ELIBACC:79,ELIBBAD:80,ELIBSCN:81,ELIBMAX:82,ELIBEXEC:83,ENOSYS:38,ENOTEMPTY:39,ENAMETOOLONG:36,ELOOP:40,EOPNOTSUPP:95,EPFNOSUPPORT:96,ECONNRESET:104,ENOBUFS:105,EAFNOSUPPORT:97,EPROTOTYPE:91,ENOTSOCK:88,ENOPROTOOPT:92,ESHUTDOWN:108,ECONNREFUSED:111,EADDRINUSE:98,ECONNABORTED:103,ENETUNREACH:101,ENETDOWN:100,ETIMEDOUT:110,EHOSTDOWN:112,EHOSTUNREACH:113,EINPROGRESS:115,EALREADY:114,EDESTADDRREQ:89,EMSGSIZE:90,EPROTONOSUPPORT:93,ESOCKTNOSUPPORT:94,EADDRNOTAVAIL:99,ENETRESET:102,EISCONN:106,ENOTCONN:107,ETOOMANYREFS:109,EUSERS:87,EDQUOT:122,ESTALE:116,ENOTSUP:95,ENOMEDIUM:123,EILSEQ:84,EOVERFLOW:75,ECANCELED:125,ENOTRECOVERABLE:131,EOWNERDEAD:130,ESTRPIPE:86};function _sysconf(name) {
      // long sysconf(int name);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/sysconf.html
      switch(name) {
        case 30: return PAGE_SIZE;
        case 85: return totalMemory / PAGE_SIZE;
        case 132:
        case 133:
        case 12:
        case 137:
        case 138:
        case 15:
        case 235:
        case 16:
        case 17:
        case 18:
        case 19:
        case 20:
        case 149:
        case 13:
        case 10:
        case 236:
        case 153:
        case 9:
        case 21:
        case 22:
        case 159:
        case 154:
        case 14:
        case 77:
        case 78:
        case 139:
        case 80:
        case 81:
        case 82:
        case 68:
        case 67:
        case 164:
        case 11:
        case 29:
        case 47:
        case 48:
        case 95:
        case 52:
        case 51:
        case 46:
          return 200809;
        case 79:
          return 0;
        case 27:
        case 246:
        case 127:
        case 128:
        case 23:
        case 24:
        case 160:
        case 161:
        case 181:
        case 182:
        case 242:
        case 183:
        case 184:
        case 243:
        case 244:
        case 245:
        case 165:
        case 178:
        case 179:
        case 49:
        case 50:
        case 168:
        case 169:
        case 175:
        case 170:
        case 171:
        case 172:
        case 97:
        case 76:
        case 32:
        case 173:
        case 35:
          return -1;
        case 176:
        case 177:
        case 7:
        case 155:
        case 8:
        case 157:
        case 125:
        case 126:
        case 92:
        case 93:
        case 129:
        case 130:
        case 131:
        case 94:
        case 91:
          return 1;
        case 74:
        case 60:
        case 69:
        case 70:
        case 4:
          return 1024;
        case 31:
        case 42:
        case 72:
          return 32;
        case 87:
        case 26:
        case 33:
          return 2147483647;
        case 34:
        case 1:
          return 47839;
        case 38:
        case 36:
          return 99;
        case 43:
        case 37:
          return 2048;
        case 0: return 2097152;
        case 3: return 65536;
        case 28: return 32768;
        case 44: return 32767;
        case 75: return 16384;
        case 39: return 1000;
        case 89: return 700;
        case 71: return 256;
        case 40: return 255;
        case 2: return 100;
        case 180: return 64;
        case 25: return 20;
        case 5: return 16;
        case 6: return 6;
        case 73: return 4;
        case 84: {
          if (typeof navigator === 'object') return navigator['hardwareConcurrency'] || 1;
          return 1;
        }
      }
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }

  
  function __ZSt18uncaught_exceptionv() { // std::uncaught_exception()
      return !!__ZSt18uncaught_exceptionv.uncaught_exception;
    }
  
  
  
  var EXCEPTIONS={last:0,caught:[],infos:{},deAdjust:function (adjusted) {
        if (!adjusted || EXCEPTIONS.infos[adjusted]) return adjusted;
        for (var ptr in EXCEPTIONS.infos) {
          var info = EXCEPTIONS.infos[ptr];
          if (info.adjusted === adjusted) {
            return ptr;
          }
        }
        return adjusted;
      },addRef:function (ptr) {
        if (!ptr) return;
        var info = EXCEPTIONS.infos[ptr];
        info.refcount++;
      },decRef:function (ptr) {
        if (!ptr) return;
        var info = EXCEPTIONS.infos[ptr];
        assert(info.refcount > 0);
        info.refcount--;
        if (info.refcount === 0) {
          if (info.destructor) {
            Runtime.dynCall('vi', info.destructor, [ptr]);
          }
          delete EXCEPTIONS.infos[ptr];
          ___cxa_free_exception(ptr);
        }
      },clearRef:function (ptr) {
        if (!ptr) return;
        var info = EXCEPTIONS.infos[ptr];
        info.refcount = 0;
      }};
  function ___resumeException(ptr) {
      if (!EXCEPTIONS.last) { EXCEPTIONS.last = ptr; }
      EXCEPTIONS.clearRef(EXCEPTIONS.deAdjust(ptr)); // exception refcount should be cleared, but don't free it
      throw ptr + " - Exception catching is disabled, this exception cannot be caught. Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.";
    }function ___cxa_find_matching_catch() {
      var thrown = EXCEPTIONS.last;
      if (!thrown) {
        // just pass through the null ptr
        return ((asm["setTempRet0"](0),0)|0);
      }
      var info = EXCEPTIONS.infos[thrown];
      var throwntype = info.type;
      if (!throwntype) {
        // just pass through the thrown ptr
        return ((asm["setTempRet0"](0),thrown)|0);
      }
      var typeArray = Array.prototype.slice.call(arguments);
  
      var pointer = Module['___cxa_is_pointer_type'](throwntype);
      // can_catch receives a **, add indirection
      if (!___cxa_find_matching_catch.buffer) ___cxa_find_matching_catch.buffer = _malloc(4);
      HEAP32[((___cxa_find_matching_catch.buffer)>>2)]=thrown;
      thrown = ___cxa_find_matching_catch.buffer;
      // The different catch blocks are denoted by different types.
      // Due to inheritance, those types may not precisely match the
      // type of the thrown object. Find one which matches, and
      // return the type of the catch block which should be called.
      for (var i = 0; i < typeArray.length; i++) {
        if (typeArray[i] && Module['___cxa_can_catch'](typeArray[i], throwntype, thrown)) {
          thrown = HEAP32[((thrown)>>2)]; // undo indirection
          info.adjusted = thrown;
          return ((asm["setTempRet0"](typeArray[i]),thrown)|0);
        }
      }
      // Shouldn't happen unless we have bogus data in typeArray
      // or encounter a type for which emscripten doesn't have suitable
      // typeinfo defined. Best-efforts match just in case.
      thrown = HEAP32[((thrown)>>2)]; // undo indirection
      return ((asm["setTempRet0"](throwntype),thrown)|0);
    }function ___cxa_throw(ptr, type, destructor) {
      EXCEPTIONS.infos[ptr] = {
        ptr: ptr,
        adjusted: ptr,
        type: type,
        destructor: destructor,
        refcount: 0
      };
      EXCEPTIONS.last = ptr;
      if (!("uncaught_exception" in __ZSt18uncaught_exceptionv)) {
        __ZSt18uncaught_exceptionv.uncaught_exception = 1;
      } else {
        __ZSt18uncaught_exceptionv.uncaught_exception++;
      }
      throw ptr + " - Exception catching is disabled, this exception cannot be caught. Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.";
    }

   
  Module["_memset"] = _memset;

   
  Module["_bitshift64Shl"] = _bitshift64Shl;

  function _abort() {
      Module['abort']();
    }

  function _pthread_once(ptr, func) {
      if (!_pthread_once.seen) _pthread_once.seen = {};
      if (ptr in _pthread_once.seen) return;
      Runtime.dynCall('v', func);
      _pthread_once.seen[ptr] = 1;
    }

  function ___lock() {}

  function ___unlock() {}

  
  var PTHREAD_SPECIFIC={};function _pthread_getspecific(key) {
      return PTHREAD_SPECIFIC[key] || 0;
    }

  function ___assert_fail(condition, filename, line, func) {
      ABORT = true;
      throw 'Assertion failed: ' + Pointer_stringify(condition) + ', at: ' + [filename ? Pointer_stringify(filename) : 'unknown filename', line, func ? Pointer_stringify(func) : 'unknown function'] + ' at ' + stackTrace();
    }

  
  var PTHREAD_SPECIFIC_NEXT_KEY=1;function _pthread_key_create(key, destructor) {
      if (key == 0) {
        return ERRNO_CODES.EINVAL;
      }
      HEAP32[((key)>>2)]=PTHREAD_SPECIFIC_NEXT_KEY;
      // values start at 0
      PTHREAD_SPECIFIC[PTHREAD_SPECIFIC_NEXT_KEY] = 0;
      PTHREAD_SPECIFIC_NEXT_KEY++;
      return 0;
    }

  function _ftime(p) {
      var millis = Date.now();
      HEAP32[((p)>>2)]=(millis/1000)|0;
      HEAP16[(((p)+(4))>>1)]=millis % 1000;
      HEAP16[(((p)+(6))>>1)]=0; // Obsolete field
      HEAP16[(((p)+(8))>>1)]=0; // Obsolete field
      return 0;
    }

  function _pthread_setspecific(key, value) {
      if (!(key in PTHREAD_SPECIFIC)) {
        return ERRNO_CODES.EINVAL;
      }
      PTHREAD_SPECIFIC[key] = value;
      return 0;
    }

  
  function _malloc(bytes) {
      /* Over-allocate to make sure it is byte-aligned by 8.
       * This will leak memory, but this is only the dummy
       * implementation (replaced by dlmalloc normally) so
       * not an issue.
       */
      var ptr = Runtime.dynamicAlloc(bytes + 8);
      return (ptr+8) & 0xFFFFFFF8;
    }
  Module["_malloc"] = _malloc;function ___cxa_allocate_exception(size) {
      return _malloc(size);
    }

  
  var SYSCALLS={varargs:0,get:function (varargs) {
        SYSCALLS.varargs += 4;
        var ret = HEAP32[(((SYSCALLS.varargs)-(4))>>2)];
        return ret;
      },getStr:function () {
        var ret = Pointer_stringify(SYSCALLS.get());
        return ret;
      },get64:function () {
        var low = SYSCALLS.get(), high = SYSCALLS.get();
        if (low >= 0) assert(high === 0);
        else assert(high === -1);
        return low;
      },getZero:function () {
        assert(SYSCALLS.get() === 0);
      }};function ___syscall54(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // ioctl
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

   
  Module["_i64Add"] = _i64Add;

   
  Module["_bitshift64Lshr"] = _bitshift64Lshr;

  function _pthread_cleanup_push(routine, arg) {
      __ATEXIT__.push(function() { Runtime.dynCall('vi', routine, [arg]) })
      _pthread_cleanup_push.level = __ATEXIT__.length;
    }

  function _pthread_cleanup_pop() {
      assert(_pthread_cleanup_push.level == __ATEXIT__.length, 'cannot pop if something else added meanwhile!');
      __ATEXIT__.pop();
      _pthread_cleanup_push.level = __ATEXIT__.length;
    }

  function ___cxa_begin_catch(ptr) {
      __ZSt18uncaught_exceptionv.uncaught_exception--;
      EXCEPTIONS.caught.push(ptr);
      EXCEPTIONS.addRef(EXCEPTIONS.deAdjust(ptr));
      return ptr;
    }

  
  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.set(HEAPU8.subarray(src, src+num), dest);
      return dest;
    } 
  Module["_memcpy"] = _memcpy;

  function ___syscall6(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // close
      var stream = SYSCALLS.getStreamFromFD();
      FS.close(stream);
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function _sbrk(bytes) {
      // Implement a Linux-like 'memory area' for our 'process'.
      // Changes the size of the memory area by |bytes|; returns the
      // address of the previous top ('break') of the memory area
      // We control the "dynamic" memory - DYNAMIC_BASE to DYNAMICTOP
      var self = _sbrk;
      if (!self.called) {
        DYNAMICTOP = alignMemoryPage(DYNAMICTOP); // make sure we start out aligned
        self.called = true;
        assert(Runtime.dynamicAlloc);
        self.alloc = Runtime.dynamicAlloc;
        Runtime.dynamicAlloc = function() { abort('cannot dynamically allocate, sbrk now has control') };
      }
      var ret = DYNAMICTOP;
      if (bytes != 0) {
        var success = self.alloc(bytes);
        if (!success) return -1 >>> 0; // sbrk failure code
      }
      return ret;  // Previous break location.
    }

  function ___gxx_personality_v0() {
    }

  function _time(ptr) {
      var ret = (Date.now()/1000)|0;
      if (ptr) {
        HEAP32[((ptr)>>2)]=ret;
      }
      return ret;
    }

  function _pthread_self() {
      //FIXME: assumes only a single thread
      return 0;
    }

  function ___syscall140(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // llseek
      var stream = SYSCALLS.getStreamFromFD(), offset_high = SYSCALLS.get(), offset_low = SYSCALLS.get(), result = SYSCALLS.get(), whence = SYSCALLS.get();
      var offset = offset_low;
      assert(offset_high === 0);
      FS.llseek(stream, offset, whence);
      HEAP32[((result)>>2)]=stream.position;
      if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null; // reset readdir state
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall146(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // writev
      // hack to support printf in NO_FILESYSTEM
      var stream = SYSCALLS.get(), iov = SYSCALLS.get(), iovcnt = SYSCALLS.get();
      var ret = 0;
      if (!___syscall146.buffer) {
        ___syscall146.buffers = [null, [], []]; // 1 => stdout, 2 => stderr
        ___syscall146.printChar = function(stream, curr) {
          var buffer = ___syscall146.buffers[stream];
          assert(buffer);
          if (curr === 0 || curr === 10) {
            (stream === 1 ? Module['print'] : Module['printErr'])(UTF8ArrayToString(buffer, 0));
            buffer.length = 0;
          } else {
            buffer.push(curr);
          }
        };
      }
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAP32[(((iov)+(i*8))>>2)];
        var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
        for (var j = 0; j < len; j++) {
          ___syscall146.printChar(stream, HEAPU8[ptr+j]);
        }
        ret += len;
      }
      return ret;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  var ___dso_handle=STATICTOP; STATICTOP += 16;;
/* flush anything remaining in the buffer during shutdown */ __ATEXIT__.push(function() { var fflush = Module["_fflush"]; if (fflush) fflush(0); var printChar = ___syscall146.printChar; if (!printChar) return; var buffers = ___syscall146.buffers; if (buffers[1].length) printChar(1, 10); if (buffers[2].length) printChar(2, 10); });;
STACK_BASE = STACKTOP = Runtime.alignMemory(STATICTOP);

staticSealed = true; // seal the static portion of memory

STACK_MAX = STACK_BASE + TOTAL_STACK;

DYNAMIC_BASE = DYNAMICTOP = Runtime.alignMemory(STACK_MAX);

 var cttz_i8 = allocate([8,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,5,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,6,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,5,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,7,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,5,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,6,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,5,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,4,0,1,0,2,0,1,0,3,0,1,0,2,0,1,0], "i8", ALLOC_DYNAMIC);


function invoke_iiii(index,a1,a2,a3) {
  try {
    return Module["dynCall_iiii"](index,a1,a2,a3);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    asm["setThrew"](1, 0);
  }
}

function invoke_viiiii(index,a1,a2,a3,a4,a5) {
  try {
    Module["dynCall_viiiii"](index,a1,a2,a3,a4,a5);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    asm["setThrew"](1, 0);
  }
}

function invoke_i(index) {
  try {
    return Module["dynCall_i"](index);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    asm["setThrew"](1, 0);
  }
}

function invoke_vi(index,a1) {
  try {
    Module["dynCall_vi"](index,a1);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    asm["setThrew"](1, 0);
  }
}

function invoke_ii(index,a1) {
  try {
    return Module["dynCall_ii"](index,a1);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    asm["setThrew"](1, 0);
  }
}

function invoke_v(index) {
  try {
    Module["dynCall_v"](index);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    asm["setThrew"](1, 0);
  }
}

function invoke_viiiiii(index,a1,a2,a3,a4,a5,a6) {
  try {
    Module["dynCall_viiiiii"](index,a1,a2,a3,a4,a5,a6);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    asm["setThrew"](1, 0);
  }
}

function invoke_iii(index,a1,a2) {
  try {
    return Module["dynCall_iii"](index,a1,a2);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    asm["setThrew"](1, 0);
  }
}

function invoke_viiii(index,a1,a2,a3,a4) {
  try {
    Module["dynCall_viiii"](index,a1,a2,a3,a4);
  } catch(e) {
    if (typeof e !== 'number' && e !== 'longjmp') throw e;
    asm["setThrew"](1, 0);
  }
}

Module.asmGlobalArg = { "Math": Math, "Int8Array": Int8Array, "Int16Array": Int16Array, "Int32Array": Int32Array, "Uint8Array": Uint8Array, "Uint16Array": Uint16Array, "Uint32Array": Uint32Array, "Float32Array": Float32Array, "Float64Array": Float64Array, "NaN": NaN, "Infinity": Infinity, "SIMD": SIMD };

Module.asmLibraryArg = { "abort": abort, "assert": assert, "invoke_iiii": invoke_iiii, "invoke_viiiii": invoke_viiiii, "invoke_i": invoke_i, "invoke_vi": invoke_vi, "invoke_ii": invoke_ii, "invoke_v": invoke_v, "invoke_viiiiii": invoke_viiiiii, "invoke_iii": invoke_iii, "invoke_viiii": invoke_viiii, "_pthread_cleanup_pop": _pthread_cleanup_pop, "_pthread_key_create": _pthread_key_create, "_abort": _abort, "___gxx_personality_v0": ___gxx_personality_v0, "___assert_fail": ___assert_fail, "___cxa_allocate_exception": ___cxa_allocate_exception, "___cxa_find_matching_catch": ___cxa_find_matching_catch, "___setErrNo": ___setErrNo, "_sbrk": _sbrk, "___cxa_begin_catch": ___cxa_begin_catch, "_emscripten_memcpy_big": _emscripten_memcpy_big, "___resumeException": ___resumeException, "__ZSt18uncaught_exceptionv": __ZSt18uncaught_exceptionv, "_sysconf": _sysconf, "_pthread_getspecific": _pthread_getspecific, "_pthread_self": _pthread_self, "_pthread_once": _pthread_once, "___syscall54": ___syscall54, "___unlock": ___unlock, "_pthread_setspecific": _pthread_setspecific, "___cxa_atexit": ___cxa_atexit, "___cxa_throw": ___cxa_throw, "___lock": ___lock, "___syscall6": ___syscall6, "_pthread_cleanup_push": _pthread_cleanup_push, "_time": _time, "_ftime": _ftime, "_atexit": _atexit, "___syscall140": ___syscall140, "___syscall146": ___syscall146, "STACKTOP": STACKTOP, "STACK_MAX": STACK_MAX, "tempDoublePtr": tempDoublePtr, "ABORT": ABORT, "cttz_i8": cttz_i8, "___dso_handle": ___dso_handle };
// EMSCRIPTEN_START_ASM
var asm = (function(global, env, buffer) {
  'use asm';
  
  
  var HEAP8 = new global.Int8Array(buffer);
  var HEAP16 = new global.Int16Array(buffer);
  var HEAP32 = new global.Int32Array(buffer);
  var HEAPU8 = new global.Uint8Array(buffer);
  var HEAPU16 = new global.Uint16Array(buffer);
  var HEAPU32 = new global.Uint32Array(buffer);
  var HEAPF32 = new global.Float32Array(buffer);
  var HEAPF64 = new global.Float64Array(buffer);


  var STACKTOP=env.STACKTOP|0;
  var STACK_MAX=env.STACK_MAX|0;
  var tempDoublePtr=env.tempDoublePtr|0;
  var ABORT=env.ABORT|0;
  var cttz_i8=env.cttz_i8|0;
  var ___dso_handle=env.___dso_handle|0;

  var __THREW__ = 0;
  var threwValue = 0;
  var setjmpId = 0;
  var undef = 0;
  var nan = global.NaN, inf = global.Infinity;
  var tempInt = 0, tempBigInt = 0, tempBigIntP = 0, tempBigIntS = 0, tempBigIntR = 0.0, tempBigIntI = 0, tempBigIntD = 0, tempValue = 0, tempDouble = 0.0;

  var tempRet0 = 0;
  var tempRet1 = 0;
  var tempRet2 = 0;
  var tempRet3 = 0;
  var tempRet4 = 0;
  var tempRet5 = 0;
  var tempRet6 = 0;
  var tempRet7 = 0;
  var tempRet8 = 0;
  var tempRet9 = 0;
  var Math_floor=global.Math.floor;
  var Math_abs=global.Math.abs;
  var Math_sqrt=global.Math.sqrt;
  var Math_pow=global.Math.pow;
  var Math_cos=global.Math.cos;
  var Math_sin=global.Math.sin;
  var Math_tan=global.Math.tan;
  var Math_acos=global.Math.acos;
  var Math_asin=global.Math.asin;
  var Math_atan=global.Math.atan;
  var Math_atan2=global.Math.atan2;
  var Math_exp=global.Math.exp;
  var Math_log=global.Math.log;
  var Math_ceil=global.Math.ceil;
  var Math_imul=global.Math.imul;
  var Math_min=global.Math.min;
  var Math_clz32=global.Math.clz32;
  var Math_fround=global.Math.fround;
  var abort=env.abort;
  var assert=env.assert;
  var invoke_iiii=env.invoke_iiii;
  var invoke_viiiii=env.invoke_viiiii;
  var invoke_i=env.invoke_i;
  var invoke_vi=env.invoke_vi;
  var invoke_ii=env.invoke_ii;
  var invoke_v=env.invoke_v;
  var invoke_viiiiii=env.invoke_viiiiii;
  var invoke_iii=env.invoke_iii;
  var invoke_viiii=env.invoke_viiii;
  var _pthread_cleanup_pop=env._pthread_cleanup_pop;
  var _pthread_key_create=env._pthread_key_create;
  var _abort=env._abort;
  var ___gxx_personality_v0=env.___gxx_personality_v0;
  var ___assert_fail=env.___assert_fail;
  var ___cxa_allocate_exception=env.___cxa_allocate_exception;
  var ___cxa_find_matching_catch=env.___cxa_find_matching_catch;
  var ___setErrNo=env.___setErrNo;
  var _sbrk=env._sbrk;
  var ___cxa_begin_catch=env.___cxa_begin_catch;
  var _emscripten_memcpy_big=env._emscripten_memcpy_big;
  var ___resumeException=env.___resumeException;
  var __ZSt18uncaught_exceptionv=env.__ZSt18uncaught_exceptionv;
  var _sysconf=env._sysconf;
  var _pthread_getspecific=env._pthread_getspecific;
  var _pthread_self=env._pthread_self;
  var _pthread_once=env._pthread_once;
  var ___syscall54=env.___syscall54;
  var ___unlock=env.___unlock;
  var _pthread_setspecific=env._pthread_setspecific;
  var ___cxa_atexit=env.___cxa_atexit;
  var ___cxa_throw=env.___cxa_throw;
  var ___lock=env.___lock;
  var ___syscall6=env.___syscall6;
  var _pthread_cleanup_push=env._pthread_cleanup_push;
  var _time=env._time;
  var _ftime=env._ftime;
  var _atexit=env._atexit;
  var ___syscall140=env.___syscall140;
  var ___syscall146=env.___syscall146;
  var SIMD_Float32x4=global.SIMD.Float32x4;
  var SIMD_Int32x4=global.SIMD.Int32x4;
  var SIMD_Bool32x4=global.SIMD.Bool32x4;
  var SIMD_Int32x4_splat=SIMD_Int32x4.splat;
  var SIMD_Int32x4_check=SIMD_Int32x4.check;
  var SIMD_Int32x4_extractLane=SIMD_Int32x4.extractLane;
  var SIMD_Int32x4_replaceLane=SIMD_Int32x4.replaceLane;
  var SIMD_Int32x4_add=SIMD_Int32x4.add;
  var SIMD_Int32x4_sub=SIMD_Int32x4.sub;
  var SIMD_Int32x4_neg=SIMD_Int32x4.neg;
  var SIMD_Int32x4_mul=SIMD_Int32x4.mul;
  var SIMD_Int32x4_equal=SIMD_Int32x4.equal;
  var SIMD_Int32x4_lessThan=SIMD_Int32x4.lessThan;
  var SIMD_Int32x4_greaterThan=SIMD_Int32x4.greaterThan;
  var SIMD_Int32x4_notEqual=SIMD_Int32x4.notEqual;
  var SIMD_Int32x4_lessThanOrEqual=SIMD_Int32x4.lessThanOrEqual;
  var SIMD_Int32x4_greaterThanOrEqual=SIMD_Int32x4.greaterThanOrEqual;
  var SIMD_Int32x4_select=SIMD_Int32x4.select;
  var SIMD_Int32x4_swizzle=SIMD_Int32x4.swizzle;
  var SIMD_Int32x4_shuffle=SIMD_Int32x4.shuffle;
  var SIMD_Int32x4_load=SIMD_Int32x4.load;
  var SIMD_Int32x4_store=SIMD_Int32x4.store;
  var SIMD_Int32x4_load1=SIMD_Int32x4.load1;
  var SIMD_Int32x4_store1=SIMD_Int32x4.store1;
  var SIMD_Int32x4_load2=SIMD_Int32x4.load2;
  var SIMD_Int32x4_store2=SIMD_Int32x4.store2;
  var SIMD_Int32x4_load3=SIMD_Int32x4.load3;
  var SIMD_Int32x4_store3=SIMD_Int32x4.store3;
  var SIMD_Int32x4_fromFloat32x4=SIMD_Int32x4.fromFloat32x4;
  var SIMD_Int32x4_fromFloat32x4Bits=SIMD_Int32x4.fromFloat32x4Bits;
  var SIMD_Int32x4_and=SIMD_Int32x4.and;
  var SIMD_Int32x4_xor=SIMD_Int32x4.xor;
  var SIMD_Int32x4_or=SIMD_Int32x4.or;
  var SIMD_Int32x4_not=SIMD_Int32x4.not;
  var SIMD_Int32x4_shiftLeftByScalar=SIMD_Int32x4.shiftLeftByScalar;
  var SIMD_Int32x4_shiftRightByScalar=SIMD_Int32x4.shiftRightByScalar;
  var SIMD_Float32x4_splat=SIMD_Float32x4.splat;
  var SIMD_Float32x4_check=SIMD_Float32x4.check;
  var SIMD_Float32x4_extractLane=SIMD_Float32x4.extractLane;
  var SIMD_Float32x4_replaceLane=SIMD_Float32x4.replaceLane;
  var SIMD_Float32x4_add=SIMD_Float32x4.add;
  var SIMD_Float32x4_sub=SIMD_Float32x4.sub;
  var SIMD_Float32x4_neg=SIMD_Float32x4.neg;
  var SIMD_Float32x4_mul=SIMD_Float32x4.mul;
  var SIMD_Float32x4_equal=SIMD_Float32x4.equal;
  var SIMD_Float32x4_lessThan=SIMD_Float32x4.lessThan;
  var SIMD_Float32x4_greaterThan=SIMD_Float32x4.greaterThan;
  var SIMD_Float32x4_notEqual=SIMD_Float32x4.notEqual;
  var SIMD_Float32x4_lessThanOrEqual=SIMD_Float32x4.lessThanOrEqual;
  var SIMD_Float32x4_greaterThanOrEqual=SIMD_Float32x4.greaterThanOrEqual;
  var SIMD_Float32x4_select=SIMD_Float32x4.select;
  var SIMD_Float32x4_swizzle=SIMD_Float32x4.swizzle;
  var SIMD_Float32x4_shuffle=SIMD_Float32x4.shuffle;
  var SIMD_Float32x4_load=SIMD_Float32x4.load;
  var SIMD_Float32x4_store=SIMD_Float32x4.store;
  var SIMD_Float32x4_load1=SIMD_Float32x4.load1;
  var SIMD_Float32x4_store1=SIMD_Float32x4.store1;
  var SIMD_Float32x4_load2=SIMD_Float32x4.load2;
  var SIMD_Float32x4_store2=SIMD_Float32x4.store2;
  var SIMD_Float32x4_load3=SIMD_Float32x4.load3;
  var SIMD_Float32x4_store3=SIMD_Float32x4.store3;
  var SIMD_Float32x4_fromInt32x4=SIMD_Float32x4.fromInt32x4;
  var SIMD_Float32x4_fromInt32x4Bits=SIMD_Float32x4.fromInt32x4Bits;
  var SIMD_Float32x4_div=SIMD_Float32x4.div;
  var SIMD_Float32x4_min=SIMD_Float32x4.min;
  var SIMD_Float32x4_max=SIMD_Float32x4.max;
  var SIMD_Float32x4_minNum=SIMD_Float32x4.minNum;
  var SIMD_Float32x4_maxNum=SIMD_Float32x4.maxNum;
  var SIMD_Float32x4_sqrt=SIMD_Float32x4.sqrt;
  var SIMD_Float32x4_abs=SIMD_Float32x4.abs;
  var SIMD_Float32x4_reciprocalApproximation=SIMD_Float32x4.reciprocalApproximation;
  var SIMD_Float32x4_reciprocalSqrtApproximation=SIMD_Float32x4.reciprocalSqrtApproximation;
  var SIMD_Bool32x4_splat=SIMD_Bool32x4.splat;
  var SIMD_Bool32x4_check=SIMD_Bool32x4.check;
  var SIMD_Bool32x4_extractLane=SIMD_Bool32x4.extractLane;
  var SIMD_Bool32x4_replaceLane=SIMD_Bool32x4.replaceLane;
  var SIMD_Bool32x4_and=SIMD_Bool32x4.and;
  var SIMD_Bool32x4_xor=SIMD_Bool32x4.xor;
  var SIMD_Bool32x4_or=SIMD_Bool32x4.or;
  var SIMD_Bool32x4_not=SIMD_Bool32x4.not;
  var SIMD_Bool32x4_anyTrue=SIMD_Bool32x4.anyTrue;
  var SIMD_Bool32x4_allTrue=SIMD_Bool32x4.allTrue;
  var tempFloat = Math_fround(0);
  const f0 = Math_fround(0);

// EMSCRIPTEN_START_FUNCS

function stackAlloc(size) {
  size = size|0;
  var ret = 0;
  ret = STACKTOP;
  STACKTOP = (STACKTOP + size)|0;
  STACKTOP = (STACKTOP + 15)&-16;

  return ret|0;
}
function stackSave() {
  return STACKTOP|0;
}
function stackRestore(top) {
  top = top|0;
  STACKTOP = top;
}
function establishStackSpace(stackBase, stackMax) {
  stackBase = stackBase|0;
  stackMax = stackMax|0;
  STACKTOP = stackBase;
  STACK_MAX = stackMax;
}

function setThrew(threw, value) {
  threw = threw|0;
  value = value|0;
  if ((__THREW__|0) == 0) {
    __THREW__ = threw;
    threwValue = value;
  }
}
function copyTempFloat(ptr) {
  ptr = ptr|0;
  HEAP8[tempDoublePtr>>0] = HEAP8[ptr>>0];
  HEAP8[tempDoublePtr+1>>0] = HEAP8[ptr+1>>0];
  HEAP8[tempDoublePtr+2>>0] = HEAP8[ptr+2>>0];
  HEAP8[tempDoublePtr+3>>0] = HEAP8[ptr+3>>0];
}
function copyTempDouble(ptr) {
  ptr = ptr|0;
  HEAP8[tempDoublePtr>>0] = HEAP8[ptr>>0];
  HEAP8[tempDoublePtr+1>>0] = HEAP8[ptr+1>>0];
  HEAP8[tempDoublePtr+2>>0] = HEAP8[ptr+2>>0];
  HEAP8[tempDoublePtr+3>>0] = HEAP8[ptr+3>>0];
  HEAP8[tempDoublePtr+4>>0] = HEAP8[ptr+4>>0];
  HEAP8[tempDoublePtr+5>>0] = HEAP8[ptr+5>>0];
  HEAP8[tempDoublePtr+6>>0] = HEAP8[ptr+6>>0];
  HEAP8[tempDoublePtr+7>>0] = HEAP8[ptr+7>>0];
}

function setTempRet0(value) {
  value = value|0;
  tempRet0 = value;
}
function getTempRet0() {
  return tempRet0|0;
}

function __Z11printResultPc($str) {
 $str = $str|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 (_puts($str)|0);
 return;
}
function __Z10printErrorPc($str) {
 $str = $str|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 (_puts($str)|0);
 return;
}
function __Z10printScorePc($str) {
 $str = $str|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 (_puts($str)|0);
 return;
}
function _main() {
 var $averageFloat32x4 = 0, $mandelbrot = 0, $matrixInverse = 0, $matrixMultiplication = 0, $matrixTranspose = 0, $outputFunctions = 0, $vertexTransform = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 304|0;
 $outputFunctions = sp + 288|0;
 $averageFloat32x4 = sp + 240|0;
 $mandelbrot = sp + 192|0;
 $matrixMultiplication = sp + 144|0;
 $vertexTransform = sp + 96|0;
 $matrixTranspose = sp + 48|0;
 $matrixInverse = sp;
 __ZN4Base15OutputFunctionsC2EPFvPcES3_S3_($outputFunctions,8,9,10);
 __ZN16AverageFloat32x4C2Ev($averageFloat32x4);
 __ZN10MandelbrotC2Ev($mandelbrot);
 __ZN20MatrixMultiplicationC2Ev($matrixMultiplication);
 __ZN15VertexTransformC2Ev($vertexTransform);
 __ZN15MatrixTransposeC2Ev($matrixTranspose);
 __ZN13MatrixInverseC2Ev($matrixInverse);
 __ZN4Base10Benchmarks6runAllERNS_15OutputFunctionsEb($outputFunctions,1);
 STACKTOP = sp;return 0;
}
function __ZN4Base15OutputFunctionsC2EPFvPcES3_S3_($this,$printResult,$printError,$printScore) {
 $this = $this|0;
 $printResult = $printResult|0;
 $printError = $printError|0;
 $printScore = $printScore|0;
 var $0 = 0, $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAP32[$this>>2] = $printResult;
 $0 = ((($this)) + 4|0);
 HEAP32[$0>>2] = $printError;
 $1 = ((($this)) + 8|0);
 HEAP32[$1>>2] = $printScore;
 return;
}
function __ZN16AverageFloat32x4C2Ev($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $0 = sp;
 $1 = (__Znwj(40)|0);
 $2 = (__ZNSt3__111char_traitsIcE6lengthEPKc(576)|0);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6__initEPKcj($0,576,$2);
 __ZN4Base13ConfigurationC2ENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPFbvES9_PFyyESB_SB_y($1,$0,1,2,1,2,3,1000,0);
 __ZN4Base9BenchmarkC2EPNS_13ConfigurationE($this,$1);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($0);
 STACKTOP = sp;return;
}
function __ZN10MandelbrotC2Ev($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $0 = sp;
 $1 = (__Znwj(40)|0);
 $2 = (__ZNSt3__111char_traitsIcE6lengthEPKc(593)|0);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6__initEPKcj($0,593,$2);
 __ZN4Base13ConfigurationC2ENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPFbvES9_PFyyESB_SB_y($1,$0,3,4,4,5,6,1000,0);
 __ZN4Base9BenchmarkC2EPNS_13ConfigurationE($this,$1);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($0);
 STACKTOP = sp;return;
}
function __ZN20MatrixMultiplicationC2Ev($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $0 = sp;
 $1 = (__Znwj(40)|0);
 $2 = (__ZNSt3__111char_traitsIcE6lengthEPKc(604)|0);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6__initEPKcj($0,604,$2);
 __ZN4Base13ConfigurationC2ENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPFbvES9_PFyyESB_SB_y($1,$0,5,6,7,8,9,1000,0);
 __ZN4Base9BenchmarkC2EPNS_13ConfigurationE($this,$1);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($0);
 STACKTOP = sp;return;
}
function __ZN15VertexTransformC2Ev($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $0 = sp;
 $1 = (__Znwj(40)|0);
 $2 = (__ZNSt3__111char_traitsIcE6lengthEPKc(625)|0);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6__initEPKcj($0,625,$2);
 __ZN4Base13ConfigurationC2ENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPFbvES9_PFyyESB_SB_y($1,$0,7,8,10,11,12,1000,0);
 __ZN4Base9BenchmarkC2EPNS_13ConfigurationE($this,$1);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($0);
 STACKTOP = sp;return;
}
function __ZN15MatrixTransposeC2Ev($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $0 = sp;
 $1 = (__Znwj(40)|0);
 $2 = (__ZNSt3__111char_traitsIcE6lengthEPKc(641)|0);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6__initEPKcj($0,641,$2);
 __ZN4Base13ConfigurationC2ENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPFbvES9_PFyyESB_SB_y($1,$0,9,10,13,14,15,1000,0);
 __ZN4Base9BenchmarkC2EPNS_13ConfigurationE($this,$1);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($0);
 STACKTOP = sp;return;
}
function __ZN13MatrixInverseC2Ev($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $0 = sp;
 $1 = (__Znwj(40)|0);
 $2 = (__ZNSt3__111char_traitsIcE6lengthEPKc(657)|0);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6__initEPKcj($0,657,$2);
 __ZN4Base13ConfigurationC2ENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPFbvES9_PFyyESB_SB_y($1,$0,11,12,16,17,18,1000,0);
 __ZN4Base9BenchmarkC2EPNS_13ConfigurationE($this,$1);
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($0);
 STACKTOP = sp;return;
}
function __ZN16AverageFloat32x49initArrayEv() {
 var $0 = 0, $1 = 0, $2 = 0, $exitcond = 0, $i$01 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $i$01 = 0;
 while(1) {
  $1 = (4032 + ($i$01<<2)|0);
  HEAPF32[$1>>2] = 0.10000000149011612;
  $2 = (($i$01) + 1)|0;
  $exitcond = ($2|0)==(10000);
  if ($exitcond) {
   break;
  } else {
   $i$01 = $2;
  }
 }
 $0 = (__ZN16AverageFloat32x411sanityCheckEv()|0);
 return ($0|0);
}
function __ZN16AverageFloat32x47cleanupEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN16AverageFloat32x411sanityCheckEv()|0);
 return ($0|0);
}
function __ZN16AverageFloat32x411simdAverageEy($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$lcssa = 0.0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $7 = 0;$8 = 0;
  tempRet0 = ($7);
  return ($8|0);
 } else {
  $10 = 0;$11 = 0;
 }
 while(1) {
  $9 = (+__ZN16AverageFloat32x417simdAverageKernelEv());
  $12 = (_i64Add(($10|0),($11|0),1,0)|0);
  $13 = tempRet0;
  $14 = ($13>>>0)<($1>>>0);
  $15 = ($12>>>0)<($0>>>0);
  $16 = ($13|0)==($1|0);
  $17 = $16 & $15;
  $18 = $14 | $17;
  if ($18) {
   $10 = $12;$11 = $13;
  } else {
   $$lcssa = $9;
   break;
  }
 }
 $5 = (~~$$lcssa)>>>0;
 $6 = +Math_abs($$lcssa) >= 1.0 ? $$lcssa > 0.0 ? (~~+Math_min(+Math_floor($$lcssa / 4294967296.0), 4294967295.0)) >>> 0 : ~~+Math_ceil(($$lcssa - +(~~$$lcssa >>> 0)) / 4294967296.0) >>> 0 : 0;
 $7 = $6;$8 = $5;
 tempRet0 = ($7);
 return ($8|0);
}
function __ZN16AverageFloat32x49average32Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$lcssa = 0.0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $7 = 0;$8 = 0;
  tempRet0 = ($7);
  return ($8|0);
 } else {
  $10 = 0;$11 = 0;
 }
 while(1) {
  $9 = (+__ZN16AverageFloat32x422nonSimdAverageKernel32Ev());
  $12 = (_i64Add(($10|0),($11|0),1,0)|0);
  $13 = tempRet0;
  $14 = ($13>>>0)<($1>>>0);
  $15 = ($12>>>0)<($0>>>0);
  $16 = ($13|0)==($1|0);
  $17 = $16 & $15;
  $18 = $14 | $17;
  if ($18) {
   $10 = $12;$11 = $13;
  } else {
   $$lcssa = $9;
   break;
  }
 }
 $5 = (~~$$lcssa)>>>0;
 $6 = +Math_abs($$lcssa) >= 1.0 ? $$lcssa > 0.0 ? (~~+Math_min(+Math_floor($$lcssa / 4294967296.0), 4294967295.0)) >>> 0 : ~~+Math_ceil(($$lcssa - +(~~$$lcssa >>> 0)) / 4294967296.0) >>> 0 : 0;
 $7 = $6;$8 = $5;
 tempRet0 = ($7);
 return ($8|0);
}
function __ZN16AverageFloat32x49average64Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$lcssa = 0.0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $7 = 0;$8 = 0;
  tempRet0 = ($7);
  return ($8|0);
 } else {
  $10 = 0;$11 = 0;
 }
 while(1) {
  $9 = (+__ZN16AverageFloat32x422nonSimdAverageKernel64Ev());
  $12 = (_i64Add(($10|0),($11|0),1,0)|0);
  $13 = tempRet0;
  $14 = ($13>>>0)<($1>>>0);
  $15 = ($12>>>0)<($0>>>0);
  $16 = ($13|0)==($1|0);
  $17 = $16 & $15;
  $18 = $14 | $17;
  if ($18) {
   $10 = $12;$11 = $13;
  } else {
   $$lcssa = $9;
   break;
  }
 }
 $5 = (~~$$lcssa)>>>0;
 $6 = +Math_abs($$lcssa) >= 1.0 ? $$lcssa > 0.0 ? (~~+Math_min(+Math_floor($$lcssa / 4294967296.0), 4294967295.0)) >>> 0 : ~~+Math_ceil(($$lcssa - +(~~$$lcssa >>> 0)) / 4294967296.0) >>> 0 : 0;
 $7 = $6;$8 = $5;
 tempRet0 = ($7);
 return ($8|0);
}
function __ZN4Base13ConfigurationC2ENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPFbvES9_PFyyESB_SB_y($this,$name,$init,$cleanup,$simd,$nonSimd32,$nonSimd64,$0,$1) {
 $this = $this|0;
 $name = $name|0;
 $init = $init|0;
 $cleanup = $cleanup|0;
 $simd = $simd|0;
 $nonSimd32 = $nonSimd32|0;
 $nonSimd64 = $nonSimd64|0;
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEEC2ERKS5_($this,$name);
 $2 = ((($this)) + 12|0);
 HEAP32[$2>>2] = $init;
 $3 = ((($this)) + 16|0);
 HEAP32[$3>>2] = $cleanup;
 $4 = ((($this)) + 20|0);
 HEAP32[$4>>2] = $simd;
 $5 = ((($this)) + 24|0);
 HEAP32[$5>>2] = $nonSimd32;
 $6 = ((($this)) + 28|0);
 HEAP32[$6>>2] = $nonSimd64;
 $7 = ((($this)) + 32|0);
 $8 = $7;
 $9 = $8;
 HEAP32[$9>>2] = $0;
 $10 = (($8) + 4)|0;
 $11 = $10;
 HEAP32[$11>>2] = $1;
 return;
}
function __ZN4Base9BenchmarkC2EPNS_13ConfigurationE($this,$config) {
 $this = $this|0;
 $config = $config|0;
 var $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAP32[$this>>2] = $config;
 $0 = ((($this)) + 4|0);
 HEAP8[$0>>0] = 0;
 $1 = ((($this)) + 5|0);
 HEAP8[$1>>0] = 1;
 $2 = ((($this)) + 6|0);
 HEAP8[$2>>0] = 1;
 __ZN4Base10Benchmarks3addEPNS_9BenchmarkE($this);
 return;
}
function ___clang_call_terminate($0) {
 $0 = $0|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 (___cxa_begin_catch(($0|0))|0);
 __ZSt9terminatev();
 // unreachable;
}
function __ZNSt3__111char_traitsIcE6lengthEPKc($__s) {
 $__s = $__s|0;
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_strlen($__s)|0);
 return ($0|0);
}
function __ZN16AverageFloat32x411sanityCheckEv() {
 var $0 = 0.0, $1 = 0.0, $10 = 0, $2 = 0.0, $3 = 0.0, $4 = 0.0, $5 = 0, $6 = 0.0, $7 = 0.0, $8 = 0.0, $9 = 0, $fabsf = 0.0, $fabsf1 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (+__ZN16AverageFloat32x417simdAverageKernelEv());
 $1 = (+__ZN16AverageFloat32x422nonSimdAverageKernel32Ev());
 $2 = (+__ZN16AverageFloat32x422nonSimdAverageKernel64Ev());
 $3 = $0 - $1;
 $fabsf = (+Math_abs((+$3)));
 $4 = $fabsf;
 $5 = $4 < 1.0E-4;
 if (!($5)) {
  $10 = 0;
  return ($10|0);
 }
 $6 = $2;
 $7 = $0 - $6;
 $fabsf1 = (+Math_abs((+$7)));
 $8 = $fabsf1;
 $9 = $8 < 1.0E-4;
 $10 = $9;
 return ($10|0);
}
function __ZN16AverageFloat32x417simdAverageKernelEv() {
 var $$lcssa = SIMD_Float32x4(0.0,0.0,0.0,0.0), $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0.0, $13 = 0.0, $14 = 0.0, $15 = 0.0, $16 = 0.0, $17 = 0.0, $18 = 0.0, $19 = 0.0, $2 = 0, $20 = 0, $21 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $22 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $23 = 0, $24 = 0, $3 = 0;
 var $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $j$01 = 0, $lanes = 0, $sumx4$02 = SIMD_Float32x4(0.0,0.0,0.0,0.0), label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $lanes = sp;
 $0 = 3984;
 $1 = $0;
 $2 = HEAP32[$1>>2]|0;
 $3 = (($0) + 4)|0;
 $4 = $3;
 $5 = HEAP32[$4>>2]|0;
 $6 = (_i64Add(($2|0),($5|0),1,0)|0);
 $7 = tempRet0;
 $8 = 3984;
 $9 = $8;
 HEAP32[$9>>2] = $6;
 $10 = (($8) + 4)|0;
 $11 = $10;
 HEAP32[$11>>2] = $7;
 $j$01 = 0;$sumx4$02 = SIMD_Float32x4_splat(Math_fround(0));
 while(1) {
  ;
  $20 = (4032 + ($j$01<<2)|0);
  $21 = SIMD_Float32x4_load(HEAPU8, $20);
  $22 = SIMD_Float32x4_add($sumx4$02,$21);
  $23 = (($j$01) + 4)|0;
  $24 = ($23>>>0)<(10000);
  if ($24) {
   $j$01 = $23;$sumx4$02 = $22;
  } else {
   $$lcssa = $22;
   break;
  }
 }
 ;
 __ZN4Base5LanesIDv4_ffEC2ES1_($lanes,$$lcssa);
 $12 = (+__ZN4Base5LanesIDv4_ffE1xEv($lanes));
 $13 = (+__ZN4Base5LanesIDv4_ffE1yEv($lanes));
 $14 = $12 + $13;
 $15 = (+__ZN4Base5LanesIDv4_ffE1zEv($lanes));
 $16 = $14 + $15;
 $17 = (+__ZN4Base5LanesIDv4_ffE1wEv($lanes));
 $18 = $16 + $17;
 $19 = $18 / 1.0E+4;
 STACKTOP = sp;return (+$19);
}
function __ZN16AverageFloat32x422nonSimdAverageKernel32Ev() {
 var $$lcssa = 0.0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0.0, $13 = 0, $14 = 0.0, $15 = 0.0, $16 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $exitcond = 0, $j$01 = 0;
 var $sum$02 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = 3984;
 $1 = $0;
 $2 = HEAP32[$1>>2]|0;
 $3 = (($0) + 4)|0;
 $4 = $3;
 $5 = HEAP32[$4>>2]|0;
 $6 = (_i64Add(($2|0),($5|0),1,0)|0);
 $7 = tempRet0;
 $8 = 3984;
 $9 = $8;
 HEAP32[$9>>2] = $6;
 $10 = (($8) + 4)|0;
 $11 = $10;
 HEAP32[$11>>2] = $7;
 $j$01 = 0;$sum$02 = 0.0;
 while(1) {
  $13 = (4032 + ($j$01<<2)|0);
  $14 = +HEAPF32[$13>>2];
  $15 = $sum$02 + $14;
  $16 = (($j$01) + 1)|0;
  $exitcond = ($16|0)==(10000);
  if ($exitcond) {
   $$lcssa = $15;
   break;
  } else {
   $j$01 = $16;$sum$02 = $15;
  }
 }
 $12 = $$lcssa / 1.0E+4;
 return (+$12);
}
function __ZN16AverageFloat32x422nonSimdAverageKernel64Ev() {
 var $$lcssa = 0.0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0.0, $13 = 0, $14 = 0.0, $15 = 0.0, $16 = 0.0, $17 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $exitcond = 0;
 var $j$01 = 0, $sum$02 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = 3984;
 $1 = $0;
 $2 = HEAP32[$1>>2]|0;
 $3 = (($0) + 4)|0;
 $4 = $3;
 $5 = HEAP32[$4>>2]|0;
 $6 = (_i64Add(($2|0),($5|0),1,0)|0);
 $7 = tempRet0;
 $8 = 3984;
 $9 = $8;
 HEAP32[$9>>2] = $6;
 $10 = (($8) + 4)|0;
 $11 = $10;
 HEAP32[$11>>2] = $7;
 $j$01 = 0;$sum$02 = 0.0;
 while(1) {
  $13 = (4032 + ($j$01<<2)|0);
  $14 = +HEAPF32[$13>>2];
  $15 = $14;
  $16 = $sum$02 + $15;
  $17 = (($j$01) + 1)|0;
  $exitcond = ($17|0)==(10000);
  if ($exitcond) {
   $$lcssa = $16;
   break;
  } else {
   $j$01 = $17;$sum$02 = $16;
  }
 }
 $12 = $$lcssa / 1.0E+4;
 return (+$12);
}
function __ZN4Base5LanesIDv4_ffEC2ES1_($this,$m128) {
 $this = $this|0;
 $m128 = SIMD_Float32x4_check($m128);
 var label = 0, sp = 0, temp_Float32x4_ptr = 0;
 sp = STACKTOP;
 temp_Float32x4_ptr = $this;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $m128);
 return;
}
function __ZN4Base5LanesIDv4_ffE1xEv($this) {
 $this = $this|0;
 var $0 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = +HEAPF32[$this>>2];
 return (+$0);
}
function __ZN4Base5LanesIDv4_ffE1yEv($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($this)) + 4|0);
 $1 = +HEAPF32[$0>>2];
 return (+$1);
}
function __ZN4Base5LanesIDv4_ffE1zEv($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($this)) + 8|0);
 $1 = +HEAPF32[$0>>2];
 return (+$1);
}
function __ZN4Base5LanesIDv4_ffE1wEv($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($this)) + 12|0);
 $1 = +HEAPF32[$0>>2];
 return (+$1);
}
function __ZN10Mandelbrot14initMandelbrotEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10Mandelbrot11sanityCheckEv()|0);
 return ($0|0);
}
function __ZN10Mandelbrot17cleanupMandelbrotEv() {
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10Mandelbrot11sanityCheckEv()|0);
 return ($0|0);
}
function __ZN10Mandelbrot14simdMandelbrotEy($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$lcssa = 0, $$lcssa25 = 0, $$lcssa26 = 0, $$lcssa27 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = SIMD_Int32x4(0,0,0,0), $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0;
 var $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $lanes = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $lanes = sp;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $14 = 0;$15 = 0;
  tempRet0 = ($14);
  STACKTOP = sp;return ($15|0);
 }
 $21 = 0;$22 = 0;
 while(1) {
  $16 = (SIMD_Int32x4_check(__ZN10Mandelbrot8mandelx4Effj(0.0099999997764825821,0.0099999997764825821,1000)));
  __ZN4Base5LanesIDv4_iiEC2ES1_($lanes,$16);
  $17 = (__ZN4Base5LanesIDv4_iiE1xEv($lanes)|0);
  $18 = (__ZN4Base5LanesIDv4_iiE1yEv($lanes)|0);
  $19 = (__ZN4Base5LanesIDv4_iiE1zEv($lanes)|0);
  $20 = (__ZN4Base5LanesIDv4_iiE1wEv($lanes)|0);
  $23 = (_i64Add(($21|0),($22|0),1,0)|0);
  $24 = tempRet0;
  $25 = ($24>>>0)<($1>>>0);
  $26 = ($23>>>0)<($0>>>0);
  $27 = ($24|0)==($1|0);
  $28 = $27 & $26;
  $29 = $25 | $28;
  if ($29) {
   $21 = $23;$22 = $24;
  } else {
   $$lcssa = $17;$$lcssa25 = $18;$$lcssa26 = $19;$$lcssa27 = $20;
   break;
  }
 }
 $5 = (_bitshift64Shl(($$lcssa|0),0,8)|0);
 $6 = tempRet0;
 $7 = $$lcssa25 | $5;
 $8 = (_bitshift64Shl(($7|0),($6|0),8)|0);
 $9 = tempRet0;
 $10 = $8 | $$lcssa26;
 $11 = (_bitshift64Shl(($10|0),($9|0),8)|0);
 $12 = tempRet0;
 $13 = $11 | $$lcssa27;
 $14 = $12;$15 = $13;
 tempRet0 = ($14);
 STACKTOP = sp;return ($15|0);
}
function __ZN10Mandelbrot19nonSimdMandelbrot32Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$lcssa = 0, $$lcssa25 = 0, $$lcssa26 = 0, $$lcssa27 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0;
 var $25 = 0, $26 = 0, $27 = 0, $28 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $14 = 0;$15 = 0;
  tempRet0 = ($14);
  return ($15|0);
 } else {
  $20 = 0;$21 = 0;
 }
 while(1) {
  $16 = (__ZN10Mandelbrot10mandelx132Effj(0.0099999997764825821,0.0099999997764825821,1000)|0);
  $17 = (__ZN10Mandelbrot10mandelx132Effj(0.0099999997764825821,0.0099999997764825821,1000)|0);
  $18 = (__ZN10Mandelbrot10mandelx132Effj(0.0099999997764825821,0.0099999997764825821,1000)|0);
  $19 = (__ZN10Mandelbrot10mandelx132Effj(0.0099999997764825821,0.0099999997764825821,1000)|0);
  $22 = (_i64Add(($20|0),($21|0),1,0)|0);
  $23 = tempRet0;
  $24 = ($23>>>0)<($1>>>0);
  $25 = ($22>>>0)<($0>>>0);
  $26 = ($23|0)==($1|0);
  $27 = $26 & $25;
  $28 = $24 | $27;
  if ($28) {
   $20 = $22;$21 = $23;
  } else {
   $$lcssa = $16;$$lcssa25 = $17;$$lcssa26 = $18;$$lcssa27 = $19;
   break;
  }
 }
 $5 = (_bitshift64Shl(($$lcssa|0),0,8)|0);
 $6 = tempRet0;
 $7 = $$lcssa25 | $5;
 $8 = (_bitshift64Shl(($7|0),($6|0),8)|0);
 $9 = tempRet0;
 $10 = $8 | $$lcssa26;
 $11 = (_bitshift64Shl(($10|0),($9|0),8)|0);
 $12 = tempRet0;
 $13 = $11 | $$lcssa27;
 $14 = $12;$15 = $13;
 tempRet0 = ($14);
 return ($15|0);
}
function __ZN10Mandelbrot19nonSimdMandelbrot64Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $$lcssa = 0, $$lcssa25 = 0, $$lcssa26 = 0, $$lcssa27 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0;
 var $25 = 0, $26 = 0, $27 = 0, $28 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $14 = 0;$15 = 0;
  tempRet0 = ($14);
  return ($15|0);
 } else {
  $20 = 0;$21 = 0;
 }
 while(1) {
  $16 = (__ZN10Mandelbrot10mandelx164Eddj(0.01,0.01,1000)|0);
  $17 = (__ZN10Mandelbrot10mandelx164Eddj(0.01,0.01,1000)|0);
  $18 = (__ZN10Mandelbrot10mandelx164Eddj(0.01,0.01,1000)|0);
  $19 = (__ZN10Mandelbrot10mandelx164Eddj(0.01,0.01,1000)|0);
  $22 = (_i64Add(($20|0),($21|0),1,0)|0);
  $23 = tempRet0;
  $24 = ($23>>>0)<($1>>>0);
  $25 = ($22>>>0)<($0>>>0);
  $26 = ($23|0)==($1|0);
  $27 = $26 & $25;
  $28 = $24 | $27;
  if ($28) {
   $20 = $22;$21 = $23;
  } else {
   $$lcssa = $16;$$lcssa25 = $17;$$lcssa26 = $18;$$lcssa27 = $19;
   break;
  }
 }
 $5 = (_bitshift64Shl(($$lcssa|0),0,8)|0);
 $6 = tempRet0;
 $7 = $$lcssa25 | $5;
 $8 = (_bitshift64Shl(($7|0),($6|0),8)|0);
 $9 = tempRet0;
 $10 = $8 | $$lcssa26;
 $11 = (_bitshift64Shl(($10|0),($9|0),8)|0);
 $12 = tempRet0;
 $13 = $11 | $$lcssa27;
 $14 = $12;$15 = $13;
 tempRet0 = ($14);
 return ($15|0);
}
function __ZN10Mandelbrot11sanityCheckEv() {
 var $$ = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__ZN10Mandelbrot14simdMandelbrotEy(1,0)|0);
 $1 = tempRet0;
 $2 = (__ZN10Mandelbrot19nonSimdMandelbrot32Ey(1,0)|0);
 $3 = tempRet0;
 $4 = (__ZN10Mandelbrot19nonSimdMandelbrot64Ey(1,0)|0);
 $5 = tempRet0;
 $6 = ($0|0)==($2|0);
 $7 = ($1|0)==($3|0);
 $8 = $6 & $7;
 $9 = ($0|0)==($4|0);
 $10 = ($1|0)==($5|0);
 $11 = $9 & $10;
 $$ = $8 & $11;
 return ($$|0);
}
function __ZN10Mandelbrot8mandelx4Effj($cre4,$cim4,$max_iterations) {
 $cre4 = +$cre4;
 $cim4 = +$cim4;
 $max_iterations = $max_iterations|0;
 var $$lobit$i = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $13 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $14 = 0, $15 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $16 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $17 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $18 = SIMD_Int32x4(0,0,0,0), $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0;
 var $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $34 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $35 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $36 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $37 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $38 = SIMD_Int32x4(0,0,0,0), $39 = SIMD_Int32x4(0,0,0,0), $4 = 0, $40 = 0, $41 = 0, $5 = 0, $6 = 0;
 var $7 = 0, $8 = 0, $9 = 0, $count4$0$lcssa = SIMD_Int32x4(0,0,0,0), $count4$01 = SIMD_Int32x4(0,0,0,0), $i$04 = 0, $z_im4$02 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $z_re4$03 = SIMD_Float32x4(0.0,0.0,0.0,0.0), label = 0, sp = 0;
 sp = STACKTOP;
 $0 = 3992;
 $1 = $0;
 $2 = HEAP32[$1>>2]|0;
 $3 = (($0) + 4)|0;
 $4 = $3;
 $5 = HEAP32[$4>>2]|0;
 $6 = (_i64Add(($2|0),($5|0),1,0)|0);
 $7 = tempRet0;
 $8 = 3992;
 $9 = $8;
 HEAP32[$9>>2] = $6;
 $10 = (($8) + 4)|0;
 $11 = $10;
 HEAP32[$11>>2] = $7;
 ;
 ;
 ;
 $12 = SIMD_Float32x4_splat(Math_fround($cre4));
 ;
 ;
 ;
 $13 = SIMD_Float32x4_splat(Math_fround($cim4));
 $14 = ($max_iterations|0)==(0);
 if ($14) {
  $count4$0$lcssa = SIMD_Int32x4_splat(0);
  ;
  return (SIMD_Int32x4_check($count4$0$lcssa));
 } else {
  $count4$01 = SIMD_Int32x4_splat(0);$i$04 = 0;$z_im4$02 = $13;$z_re4$03 = $12;
 }
 while(1) {
  ;
  ;
  ;
  $15 = SIMD_Float32x4_mul($z_re4$03,$z_re4$03);
  $16 = SIMD_Float32x4_mul($z_im4$02,$z_im4$02);
  $17 = SIMD_Float32x4_add($16,$15);
  $18 = SIMD_Int32x4_select(SIMD_Float32x4_lessThanOrEqual($17, SIMD_Float32x4_splat(Math_fround(4.0))), SIMD_Int32x4_splat(-1), SIMD_Int32x4_splat(0));
  $19 = SIMD_Int32x4_extractLane($18,0)|0;
  $$lobit$i = $19 >>> 31;
  $20 = SIMD_Int32x4_extractLane($18,1)|0;
  $21 = $20 >> 31;
  $22 = $21 & 2;
  $23 = $22 | $$lobit$i;
  $24 = SIMD_Int32x4_extractLane($18,2)|0;
  $25 = $24 >> 31;
  $26 = $25 & 4;
  $27 = $23 | $26;
  $28 = SIMD_Int32x4_extractLane($18,3)|0;
  $29 = $28 >> 31;
  $30 = $29 & 8;
  $31 = $27 | $30;
  $32 = ($31|0)==(0);
  if ($32) {
   $count4$0$lcssa = $count4$01;
   label = 4;
   break;
  }
  $33 = SIMD_Float32x4_sub($15,$16);
  $34 = SIMD_Float32x4_mul($z_re4$03,SIMD_Float32x4_splat(Math_fround(2.0)));
  $35 = SIMD_Float32x4_mul($z_im4$02,$34);
  $36 = SIMD_Float32x4_add($12,$33);
  $37 = SIMD_Float32x4_add($13,$35);
  $38 = SIMD_Int32x4_and($18,SIMD_Int32x4_splat(1));
  $39 = SIMD_Int32x4_add($38,$count4$01);
  $40 = (($i$04) + 1)|0;
  $41 = ($40>>>0)<($max_iterations>>>0);
  if ($41) {
   $count4$01 = $39;$i$04 = $40;$z_im4$02 = $37;$z_re4$03 = $36;
  } else {
   $count4$0$lcssa = $39;
   label = 4;
   break;
  }
 }
 if ((label|0) == 4) {
  ;
  return (SIMD_Int32x4_check($count4$0$lcssa));
 }
 return SIMD_Int32x4_check((SIMD_Int32x4_splat(0)));
}
function __ZN4Base5LanesIDv4_iiEC2ES1_($this,$m128) {
 $this = $this|0;
 $m128 = SIMD_Int32x4_check($m128);
 var label = 0, sp = 0, temp_Int32x4_ptr = 0;
 sp = STACKTOP;
 temp_Int32x4_ptr = $this;SIMD_Int32x4_store(HEAPU8, temp_Int32x4_ptr, $m128);
 return;
}
function __ZN4Base5LanesIDv4_iiE1xEv($this) {
 $this = $this|0;
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$this>>2]|0;
 return ($0|0);
}
function __ZN4Base5LanesIDv4_iiE1yEv($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($this)) + 4|0);
 $1 = HEAP32[$0>>2]|0;
 return ($1|0);
}
function __ZN4Base5LanesIDv4_iiE1zEv($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($this)) + 8|0);
 $1 = HEAP32[$0>>2]|0;
 return ($1|0);
}
function __ZN4Base5LanesIDv4_iiE1wEv($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($this)) + 12|0);
 $1 = HEAP32[$0>>2]|0;
 return ($1|0);
}
function _emscripten_float32x4_lessThanOrEqual($__a,$__b) {
 $__a = SIMD_Float32x4_check($__a);
 $__b = SIMD_Float32x4_check($__b);
 var $0 = SIMD_Bool32x4(0,0,0,0), $1 = SIMD_Int32x4(0,0,0,0), label = 0, sp = 0;
 sp = STACKTOP;
 $0 = SIMD_Float32x4_lessThanOrEqual($__a, $__b);
 $1 = SIMD_Int32x4_select($0, SIMD_Int32x4_splat(-1), SIMD_Int32x4_splat(0));
 return (SIMD_Int32x4_check($1));
}
function __ZN10Mandelbrot10mandelx132Effj($c_re,$c_im,$max_iterations) {
 $c_re = +$c_re;
 $c_im = +$c_im;
 $max_iterations = $max_iterations|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0.0, $14 = 0.0, $15 = 0.0, $16 = 0, $17 = 0.0, $18 = 0.0, $19 = 0.0, $2 = 0, $20 = 0.0, $21 = 0.0, $22 = 0, $23 = 0, $3 = 0, $4 = 0, $5 = 0;
 var $6 = 0, $7 = 0, $8 = 0, $9 = 0, $i$0$lcssa = 0, $i$03 = 0, $z_im$04 = 0.0, $z_re$05 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = 3992;
 $1 = $0;
 $2 = HEAP32[$1>>2]|0;
 $3 = (($0) + 4)|0;
 $4 = $3;
 $5 = HEAP32[$4>>2]|0;
 $6 = (_i64Add(($2|0),($5|0),1,0)|0);
 $7 = tempRet0;
 $8 = 3992;
 $9 = $8;
 HEAP32[$9>>2] = $6;
 $10 = (($8) + 4)|0;
 $11 = $10;
 HEAP32[$11>>2] = $7;
 $12 = ($max_iterations|0)==(0);
 if ($12) {
  $i$0$lcssa = 0;
  return ($i$0$lcssa|0);
 } else {
  $i$03 = 0;$z_im$04 = $c_im;$z_re$05 = $c_re;
 }
 while(1) {
  $13 = $z_re$05 * $z_re$05;
  $14 = $z_im$04 * $z_im$04;
  $15 = $14 + $13;
  $16 = $15 > 4.0;
  if ($16) {
   $i$0$lcssa = $i$03;
   label = 4;
   break;
  }
  $17 = $13 - $14;
  $18 = $z_re$05 * 2.0;
  $19 = $z_im$04 * $18;
  $20 = $17 + $c_re;
  $21 = $19 + $c_im;
  $22 = (($i$03) + 1)|0;
  $23 = ($22>>>0)<($max_iterations>>>0);
  if ($23) {
   $i$03 = $22;$z_im$04 = $21;$z_re$05 = $20;
  } else {
   $i$0$lcssa = $22;
   label = 4;
   break;
  }
 }
 if ((label|0) == 4) {
  return ($i$0$lcssa|0);
 }
 return (0)|0;
}
function __ZN10Mandelbrot10mandelx164Eddj($c_re,$c_im,$max_iterations) {
 $c_re = +$c_re;
 $c_im = +$c_im;
 $max_iterations = $max_iterations|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0.0, $14 = 0.0, $15 = 0.0, $16 = 0, $17 = 0.0, $18 = 0.0, $19 = 0.0, $2 = 0, $20 = 0.0, $21 = 0.0, $22 = 0, $23 = 0, $3 = 0, $4 = 0, $5 = 0;
 var $6 = 0, $7 = 0, $8 = 0, $9 = 0, $i$0$lcssa = 0, $i$03 = 0, $z_im$04 = 0.0, $z_re$05 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = 3992;
 $1 = $0;
 $2 = HEAP32[$1>>2]|0;
 $3 = (($0) + 4)|0;
 $4 = $3;
 $5 = HEAP32[$4>>2]|0;
 $6 = (_i64Add(($2|0),($5|0),1,0)|0);
 $7 = tempRet0;
 $8 = 3992;
 $9 = $8;
 HEAP32[$9>>2] = $6;
 $10 = (($8) + 4)|0;
 $11 = $10;
 HEAP32[$11>>2] = $7;
 $12 = ($max_iterations|0)==(0);
 if ($12) {
  $i$0$lcssa = 0;
  return ($i$0$lcssa|0);
 } else {
  $i$03 = 0;$z_im$04 = $c_im;$z_re$05 = $c_re;
 }
 while(1) {
  $13 = $z_re$05 * $z_re$05;
  $14 = $z_im$04 * $z_im$04;
  $15 = $14 + $13;
  $16 = $15 > 4.0;
  if ($16) {
   $i$0$lcssa = $i$03;
   label = 4;
   break;
  }
  $17 = $13 - $14;
  $18 = $z_re$05 * 2.0;
  $19 = $z_im$04 * $18;
  $20 = $17 + $c_re;
  $21 = $19 + $c_im;
  $22 = (($i$03) + 1)|0;
  $23 = ($22>>>0)<($max_iterations>>>0);
  if ($23) {
   $i$03 = $22;$z_im$04 = $21;$z_re$05 = $20;
  } else {
   $i$0$lcssa = $22;
   label = 4;
   break;
  }
 }
 if ((label|0) == 4) {
  return ($i$0$lcssa|0);
 }
 return (0)|0;
}
function __ZN20MatrixMultiplication4initEv() {
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0;
 var $45 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__Znaj(64)|0);
 HEAP32[11008] = $0;
 $1 = (__Znaj(64)|0);
 HEAP32[11009] = $1;
 $2 = (__Znaj(64)|0);
 HEAP32[11010] = $2;
 $3 = (__Znaj(64)|0);
 HEAP32[11011] = $3;
 $4 = (__Znaj(64)|0);
 HEAP32[11012] = $4;
 $5 = (__Znaj(64)|0);
 HEAP32[11013] = $5;
 $6 = HEAP32[11008]|0;
 HEAPF32[$6>>2] = 1.0;
 $7 = HEAP32[11008]|0;
 $8 = ((($7)) + 20|0);
 HEAPF32[$8>>2] = 1.0;
 $9 = HEAP32[11008]|0;
 $10 = ((($9)) + 40|0);
 HEAPF32[$10>>2] = 1.0;
 $11 = HEAP32[11008]|0;
 $12 = ((($11)) + 60|0);
 HEAPF32[$12>>2] = 1.0;
 $13 = HEAP32[11009]|0;
 HEAPF32[$13>>2] = 2.0;
 $14 = HEAP32[11009]|0;
 $15 = ((($14)) + 20|0);
 HEAPF32[$15>>2] = 2.0;
 $16 = HEAP32[11009]|0;
 $17 = ((($16)) + 40|0);
 HEAPF32[$17>>2] = 2.0;
 $18 = HEAP32[11009]|0;
 $19 = ((($18)) + 60|0);
 HEAPF32[$19>>2] = 2.0;
 $20 = HEAP32[11010]|0;
 HEAPF32[$20>>2] = 1.0;
 $21 = HEAP32[11010]|0;
 $22 = ((($21)) + 20|0);
 HEAPF32[$22>>2] = 1.0;
 $23 = HEAP32[11010]|0;
 $24 = ((($23)) + 40|0);
 HEAPF32[$24>>2] = 1.0;
 $25 = HEAP32[11010]|0;
 $26 = ((($25)) + 60|0);
 HEAPF32[$26>>2] = 1.0;
 $27 = HEAP32[11011]|0;
 HEAPF32[$27>>2] = 2.0;
 $28 = HEAP32[11011]|0;
 $29 = ((($28)) + 20|0);
 HEAPF32[$29>>2] = 2.0;
 $30 = HEAP32[11011]|0;
 $31 = ((($30)) + 40|0);
 HEAPF32[$31>>2] = 2.0;
 $32 = HEAP32[11011]|0;
 $33 = ((($32)) + 60|0);
 HEAPF32[$33>>2] = 2.0;
 (__ZN20MatrixMultiplication10multiply32Ey(1,0)|0);
 $34 = tempRet0;
 (__ZN20MatrixMultiplication12simdMultiplyEy(1,0)|0);
 $35 = tempRet0;
 $36 = HEAP32[11008]|0;
 $37 = HEAP32[11010]|0;
 $38 = (__ZN20MatrixMultiplication6equalsEPKfS1_($36,$37)|0);
 if (!($38)) {
  $45 = 0;
  return ($45|0);
 }
 $39 = HEAP32[11009]|0;
 $40 = HEAP32[11011]|0;
 $41 = (__ZN20MatrixMultiplication6equalsEPKfS1_($39,$40)|0);
 if (!($41)) {
  $45 = 0;
  return ($45|0);
 }
 $42 = HEAP32[11012]|0;
 $43 = HEAP32[11013]|0;
 $44 = (__ZN20MatrixMultiplication6equalsEPKfS1_($42,$43)|0);
 $45 = $44;
 return ($45|0);
}
function __ZN20MatrixMultiplication7cleanupEv() {
 var $$ph = 0, $$pr = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0;
 var $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0;
 var $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[11008]|0;
 HEAPF32[$0>>2] = 1.0;
 $1 = HEAP32[11008]|0;
 $2 = ((($1)) + 20|0);
 HEAPF32[$2>>2] = 1.0;
 $3 = HEAP32[11008]|0;
 $4 = ((($3)) + 40|0);
 HEAPF32[$4>>2] = 1.0;
 $5 = HEAP32[11008]|0;
 $6 = ((($5)) + 60|0);
 HEAPF32[$6>>2] = 1.0;
 $7 = HEAP32[11009]|0;
 HEAPF32[$7>>2] = 2.0;
 $8 = HEAP32[11009]|0;
 $9 = ((($8)) + 20|0);
 HEAPF32[$9>>2] = 2.0;
 $10 = HEAP32[11009]|0;
 $11 = ((($10)) + 40|0);
 HEAPF32[$11>>2] = 2.0;
 $12 = HEAP32[11009]|0;
 $13 = ((($12)) + 60|0);
 HEAPF32[$13>>2] = 2.0;
 $14 = HEAP32[11010]|0;
 HEAPF32[$14>>2] = 1.0;
 $15 = HEAP32[11010]|0;
 $16 = ((($15)) + 20|0);
 HEAPF32[$16>>2] = 1.0;
 $17 = HEAP32[11010]|0;
 $18 = ((($17)) + 40|0);
 HEAPF32[$18>>2] = 1.0;
 $19 = HEAP32[11010]|0;
 $20 = ((($19)) + 60|0);
 HEAPF32[$20>>2] = 1.0;
 $21 = HEAP32[11011]|0;
 HEAPF32[$21>>2] = 2.0;
 $22 = HEAP32[11011]|0;
 $23 = ((($22)) + 20|0);
 HEAPF32[$23>>2] = 2.0;
 $24 = HEAP32[11011]|0;
 $25 = ((($24)) + 40|0);
 HEAPF32[$25>>2] = 2.0;
 $26 = HEAP32[11011]|0;
 $27 = ((($26)) + 60|0);
 HEAPF32[$27>>2] = 2.0;
 (__ZN20MatrixMultiplication10multiply32Ey(1,0)|0);
 $28 = tempRet0;
 (__ZN20MatrixMultiplication12simdMultiplyEy(1,0)|0);
 $29 = tempRet0;
 $30 = HEAP32[11008]|0;
 $31 = HEAP32[11010]|0;
 $32 = (__ZN20MatrixMultiplication6equalsEPKfS1_($30,$31)|0);
 if ($32) {
  $33 = HEAP32[11009]|0;
  $34 = HEAP32[11011]|0;
  $35 = (__ZN20MatrixMultiplication6equalsEPKfS1_($33,$34)|0);
  if ($35) {
   $36 = HEAP32[11012]|0;
   $37 = HEAP32[11013]|0;
   $38 = (__ZN20MatrixMultiplication6equalsEPKfS1_($36,$37)|0);
   $$ph = $38;
  } else {
   $$ph = 0;
  }
  $$pr = HEAP32[11008]|0;
  $40 = $$pr;$51 = $$ph;
 } else {
  $40 = $30;$51 = 0;
 }
 $39 = ($40|0)==(0|0);
 if (!($39)) {
  __ZdaPv($40);
 }
 $41 = HEAP32[11009]|0;
 $42 = ($41|0)==(0|0);
 if (!($42)) {
  __ZdaPv($41);
 }
 $43 = HEAP32[11010]|0;
 $44 = ($43|0)==(0|0);
 if (!($44)) {
  __ZdaPv($43);
 }
 $45 = HEAP32[11011]|0;
 $46 = ($45|0)==(0|0);
 if (!($46)) {
  __ZdaPv($45);
 }
 $47 = HEAP32[11012]|0;
 $48 = ($47|0)==(0|0);
 if (!($48)) {
  __ZdaPv($47);
 }
 $49 = HEAP32[11013]|0;
 $50 = ($49|0)==(0|0);
 if ($50) {
  return ($51|0);
 }
 __ZdaPv($49);
 return ($51|0);
}
function __ZN20MatrixMultiplication12simdMultiplyEy($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $38 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $39 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $4 = 0, $40 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $41 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $42 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $43 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $44 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $45 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $46 = SIMD_Float32x4(0.0,0.0,0.0,0.0);
 var $47 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $48 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $49 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $5 = 0, $50 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $51 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $52 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $53 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $54 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $55 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $56 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $57 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $58 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $59 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $6 = 0, $60 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $61 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $62 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $63 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $64 = SIMD_Float32x4(0.0,0.0,0.0,0.0);
 var $65 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $66 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $67 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $68 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $69 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $7 = 0, $70 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $71 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $72 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $73 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $74 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $75 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $76 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $77 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $78 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $79 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $8 = 0, $80 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $81 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $82 = SIMD_Float32x4(0.0,0.0,0.0,0.0);
 var $83 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $84 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $85 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $86 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $87 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $88 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, label = 0, sp = 0, temp_Float32x4_ptr = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $31 = 4000;
  $32 = $31;
  $33 = HEAP32[$32>>2]|0;
  $34 = (($31) + 4)|0;
  $35 = $34;
  $36 = HEAP32[$35>>2]|0;
  tempRet0 = ($36);
  return ($33|0);
 }
 $5 = HEAP32[11010]|0;
 $6 = ((($5)) + 16|0);
 $7 = ((($5)) + 32|0);
 $8 = ((($5)) + 48|0);
 $9 = HEAP32[11011]|0;
 $10 = HEAP32[11013]|0;
 $11 = ((($9)) + 16|0);
 $12 = ((($10)) + 16|0);
 $13 = ((($9)) + 32|0);
 $14 = HEAP32[11013]|0;
 $15 = ((($14)) + 32|0);
 $16 = HEAP32[11011]|0;
 $17 = ((($16)) + 48|0);
 $18 = ((($14)) + 48|0);
 $19 = 4000;
 $20 = $19;
 $21 = HEAP32[$20>>2]|0;
 $22 = (($19) + 4)|0;
 $23 = $22;
 $24 = HEAP32[$23>>2]|0;
 $89 = 0;$90 = 0;
 while(1) {
  $37 = SIMD_Float32x4_load(HEAPU8, $5);
  $38 = SIMD_Float32x4_load(HEAPU8, $6);
  $39 = SIMD_Float32x4_load(HEAPU8, $7);
  $40 = SIMD_Float32x4_load(HEAPU8, $8);
  $41 = SIMD_Float32x4_load(HEAPU8, $9);
  $42 = SIMD_Float32x4_swizzle($41, 0, 0, 0, 0);
  $43 = SIMD_Float32x4_mul($37,$42);
  $44 = SIMD_Float32x4_swizzle($41, 1, 1, 1, 1);
  $45 = SIMD_Float32x4_mul($38,$44);
  $46 = SIMD_Float32x4_swizzle($41, 2, 2, 2, 2);
  $47 = SIMD_Float32x4_mul($39,$46);
  $48 = SIMD_Float32x4_swizzle($41, 3, 3, 3, 3);
  $49 = SIMD_Float32x4_mul($40,$48);
  $50 = SIMD_Float32x4_add($47,$49);
  $51 = SIMD_Float32x4_add($45,$50);
  $52 = SIMD_Float32x4_add($43,$51);
  temp_Float32x4_ptr = $10;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $52);
  $53 = SIMD_Float32x4_load(HEAPU8, $11);
  $54 = SIMD_Float32x4_swizzle($53, 0, 0, 0, 0);
  $55 = SIMD_Float32x4_mul($37,$54);
  $56 = SIMD_Float32x4_swizzle($53, 1, 1, 1, 1);
  $57 = SIMD_Float32x4_mul($38,$56);
  $58 = SIMD_Float32x4_swizzle($53, 2, 2, 2, 2);
  $59 = SIMD_Float32x4_mul($39,$58);
  $60 = SIMD_Float32x4_swizzle($53, 3, 3, 3, 3);
  $61 = SIMD_Float32x4_mul($40,$60);
  $62 = SIMD_Float32x4_add($59,$61);
  $63 = SIMD_Float32x4_add($57,$62);
  $64 = SIMD_Float32x4_add($55,$63);
  temp_Float32x4_ptr = $12;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $64);
  $65 = SIMD_Float32x4_load(HEAPU8, $13);
  $66 = SIMD_Float32x4_swizzle($65, 0, 0, 0, 0);
  $67 = SIMD_Float32x4_mul($37,$66);
  $68 = SIMD_Float32x4_swizzle($65, 1, 1, 1, 1);
  $69 = SIMD_Float32x4_mul($38,$68);
  $70 = SIMD_Float32x4_swizzle($65, 2, 2, 2, 2);
  $71 = SIMD_Float32x4_mul($39,$70);
  $72 = SIMD_Float32x4_swizzle($65, 3, 3, 3, 3);
  $73 = SIMD_Float32x4_mul($40,$72);
  $74 = SIMD_Float32x4_add($71,$73);
  $75 = SIMD_Float32x4_add($69,$74);
  $76 = SIMD_Float32x4_add($67,$75);
  temp_Float32x4_ptr = $15;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $76);
  $77 = SIMD_Float32x4_load(HEAPU8, $17);
  $78 = SIMD_Float32x4_swizzle($77, 0, 0, 0, 0);
  $79 = SIMD_Float32x4_mul($37,$78);
  $80 = SIMD_Float32x4_swizzle($77, 1, 1, 1, 1);
  $81 = SIMD_Float32x4_mul($38,$80);
  $82 = SIMD_Float32x4_swizzle($77, 2, 2, 2, 2);
  $83 = SIMD_Float32x4_mul($39,$82);
  $84 = SIMD_Float32x4_swizzle($77, 3, 3, 3, 3);
  $85 = SIMD_Float32x4_mul($40,$84);
  $86 = SIMD_Float32x4_add($83,$85);
  $87 = SIMD_Float32x4_add($81,$86);
  $88 = SIMD_Float32x4_add($79,$87);
  temp_Float32x4_ptr = $18;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $88);
  $91 = (_i64Add(($89|0),($90|0),1,0)|0);
  $92 = tempRet0;
  $93 = ($92>>>0)<($1>>>0);
  $94 = ($91>>>0)<($0>>>0);
  $95 = ($92|0)==($1|0);
  $96 = $95 & $94;
  $97 = $93 | $96;
  if ($97) {
   $89 = $91;$90 = $92;
  } else {
   break;
  }
 }
 $25 = (_i64Add(($21|0),($24|0),($0|0),($1|0))|0);
 $26 = tempRet0;
 $27 = 4000;
 $28 = $27;
 HEAP32[$28>>2] = $25;
 $29 = (($27) + 4)|0;
 $30 = $29;
 HEAP32[$30>>2] = $26;
 $31 = 4000;
 $32 = $31;
 $33 = HEAP32[$32>>2]|0;
 $34 = (($31) + 4)|0;
 $35 = $34;
 $36 = HEAP32[$35>>2]|0;
 tempRet0 = ($36);
 return ($33|0);
}
function __ZN20MatrixMultiplication10multiply32Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $100 = 0.0, $101 = 0.0, $102 = 0.0, $103 = 0.0, $104 = 0.0, $105 = 0.0, $106 = 0.0, $107 = 0.0, $108 = 0.0, $109 = 0.0, $11 = 0, $110 = 0.0, $111 = 0.0, $112 = 0.0, $113 = 0.0, $114 = 0.0, $115 = 0.0, $116 = 0.0, $117 = 0.0;
 var $118 = 0.0, $119 = 0.0, $12 = 0, $120 = 0.0, $121 = 0.0, $122 = 0.0, $123 = 0.0, $124 = 0.0, $125 = 0.0, $126 = 0.0, $127 = 0.0, $128 = 0.0, $129 = 0.0, $13 = 0, $130 = 0.0, $131 = 0.0, $132 = 0.0, $133 = 0.0, $134 = 0.0, $135 = 0.0;
 var $136 = 0.0, $137 = 0.0, $138 = 0.0, $139 = 0.0, $14 = 0, $140 = 0.0, $141 = 0.0, $142 = 0.0, $143 = 0.0, $144 = 0.0, $145 = 0.0, $146 = 0.0, $147 = 0.0, $148 = 0.0, $149 = 0.0, $15 = 0, $150 = 0.0, $151 = 0.0, $152 = 0.0, $153 = 0.0;
 var $154 = 0.0, $155 = 0.0, $156 = 0.0, $157 = 0.0, $158 = 0.0, $159 = 0.0, $16 = 0, $160 = 0.0, $161 = 0.0, $162 = 0.0, $163 = 0.0, $164 = 0.0, $165 = 0.0, $166 = 0.0, $167 = 0.0, $168 = 0.0, $169 = 0.0, $17 = 0, $170 = 0.0, $171 = 0.0;
 var $172 = 0.0, $173 = 0.0, $174 = 0.0, $175 = 0.0, $176 = 0.0, $177 = 0.0, $178 = 0.0, $179 = 0.0, $18 = 0, $180 = 0.0, $181 = 0.0, $182 = 0.0, $183 = 0.0, $184 = 0.0, $185 = 0.0, $186 = 0.0, $187 = 0.0, $188 = 0.0, $189 = 0.0, $19 = 0;
 var $190 = 0.0, $191 = 0.0, $192 = 0.0, $193 = 0.0, $194 = 0.0, $195 = 0.0, $196 = 0.0, $197 = 0.0, $198 = 0.0, $199 = 0.0, $2 = 0, $20 = 0, $200 = 0.0, $201 = 0.0, $202 = 0.0, $203 = 0.0, $204 = 0.0, $205 = 0.0, $206 = 0.0, $207 = 0.0;
 var $208 = 0.0, $209 = 0.0, $21 = 0, $210 = 0.0, $211 = 0.0, $212 = 0.0, $213 = 0.0, $214 = 0.0, $215 = 0.0, $216 = 0.0, $217 = 0.0, $218 = 0.0, $219 = 0.0, $22 = 0, $220 = 0.0, $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0;
 var $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0;
 var $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0;
 var $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0;
 var $74 = 0, $75 = 0, $76 = 0, $77 = 0.0, $78 = 0.0, $79 = 0.0, $8 = 0, $80 = 0.0, $81 = 0.0, $82 = 0.0, $83 = 0.0, $84 = 0.0, $85 = 0.0, $86 = 0.0, $87 = 0.0, $88 = 0.0, $89 = 0.0, $9 = 0, $90 = 0.0, $91 = 0.0;
 var $92 = 0.0, $93 = 0.0, $94 = 0.0, $95 = 0.0, $96 = 0.0, $97 = 0.0, $98 = 0.0, $99 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $71 = 4000;
  $72 = $71;
  $73 = HEAP32[$72>>2]|0;
  $74 = (($71) + 4)|0;
  $75 = $74;
  $76 = HEAP32[$75>>2]|0;
  tempRet0 = ($76);
  return ($73|0);
 }
 $5 = HEAP32[11008]|0;
 $6 = ((($5)) + 4|0);
 $7 = ((($5)) + 8|0);
 $8 = ((($5)) + 12|0);
 $9 = ((($5)) + 16|0);
 $10 = ((($5)) + 20|0);
 $11 = ((($5)) + 24|0);
 $12 = ((($5)) + 28|0);
 $13 = ((($5)) + 32|0);
 $14 = ((($5)) + 36|0);
 $15 = ((($5)) + 40|0);
 $16 = ((($5)) + 44|0);
 $17 = ((($5)) + 48|0);
 $18 = ((($5)) + 52|0);
 $19 = ((($5)) + 56|0);
 $20 = ((($5)) + 60|0);
 $21 = HEAP32[11009]|0;
 $22 = ((($21)) + 4|0);
 $23 = ((($21)) + 8|0);
 $24 = ((($21)) + 12|0);
 $25 = HEAP32[11012]|0;
 $26 = ((($25)) + 4|0);
 $27 = ((($25)) + 8|0);
 $28 = ((($25)) + 12|0);
 $29 = HEAP32[11009]|0;
 $30 = ((($29)) + 16|0);
 $31 = ((($29)) + 20|0);
 $32 = ((($29)) + 24|0);
 $33 = ((($29)) + 28|0);
 $34 = HEAP32[11012]|0;
 $35 = ((($34)) + 16|0);
 $36 = ((($34)) + 20|0);
 $37 = ((($34)) + 24|0);
 $38 = ((($34)) + 28|0);
 $39 = HEAP32[11009]|0;
 $40 = ((($39)) + 32|0);
 $41 = ((($39)) + 36|0);
 $42 = ((($39)) + 40|0);
 $43 = ((($39)) + 44|0);
 $44 = HEAP32[11012]|0;
 $45 = ((($44)) + 32|0);
 $46 = ((($44)) + 36|0);
 $47 = ((($44)) + 40|0);
 $48 = ((($44)) + 44|0);
 $49 = HEAP32[11009]|0;
 $50 = ((($49)) + 48|0);
 $51 = ((($49)) + 52|0);
 $52 = ((($49)) + 56|0);
 $53 = ((($49)) + 60|0);
 $54 = HEAP32[11012]|0;
 $55 = ((($54)) + 48|0);
 $56 = ((($54)) + 52|0);
 $57 = ((($54)) + 56|0);
 $58 = ((($54)) + 60|0);
 $59 = 4000;
 $60 = $59;
 $61 = HEAP32[$60>>2]|0;
 $62 = (($59) + 4)|0;
 $63 = $62;
 $64 = HEAP32[$63>>2]|0;
 $221 = 0;$222 = 0;
 while(1) {
  $77 = +HEAPF32[$5>>2];
  $78 = +HEAPF32[$6>>2];
  $79 = +HEAPF32[$7>>2];
  $80 = +HEAPF32[$8>>2];
  $81 = +HEAPF32[$9>>2];
  $82 = +HEAPF32[$10>>2];
  $83 = +HEAPF32[$11>>2];
  $84 = +HEAPF32[$12>>2];
  $85 = +HEAPF32[$13>>2];
  $86 = +HEAPF32[$14>>2];
  $87 = +HEAPF32[$15>>2];
  $88 = +HEAPF32[$16>>2];
  $89 = +HEAPF32[$17>>2];
  $90 = +HEAPF32[$18>>2];
  $91 = +HEAPF32[$19>>2];
  $92 = +HEAPF32[$20>>2];
  $93 = +HEAPF32[$21>>2];
  $94 = +HEAPF32[$22>>2];
  $95 = +HEAPF32[$23>>2];
  $96 = +HEAPF32[$24>>2];
  $97 = $77 * $93;
  $98 = $81 * $94;
  $99 = $97 + $98;
  $100 = $85 * $95;
  $101 = $99 + $100;
  $102 = $89 * $96;
  $103 = $101 + $102;
  HEAPF32[$25>>2] = $103;
  $104 = $78 * $93;
  $105 = $82 * $94;
  $106 = $104 + $105;
  $107 = $86 * $95;
  $108 = $106 + $107;
  $109 = $90 * $96;
  $110 = $108 + $109;
  HEAPF32[$26>>2] = $110;
  $111 = $79 * $93;
  $112 = $83 * $94;
  $113 = $111 + $112;
  $114 = $87 * $95;
  $115 = $113 + $114;
  $116 = $91 * $96;
  $117 = $115 + $116;
  HEAPF32[$27>>2] = $117;
  $118 = $80 * $93;
  $119 = $84 * $94;
  $120 = $118 + $119;
  $121 = $88 * $95;
  $122 = $120 + $121;
  $123 = $92 * $96;
  $124 = $122 + $123;
  HEAPF32[$28>>2] = $124;
  $125 = +HEAPF32[$30>>2];
  $126 = +HEAPF32[$31>>2];
  $127 = +HEAPF32[$32>>2];
  $128 = +HEAPF32[$33>>2];
  $129 = $77 * $125;
  $130 = $81 * $126;
  $131 = $129 + $130;
  $132 = $85 * $127;
  $133 = $131 + $132;
  $134 = $89 * $128;
  $135 = $133 + $134;
  HEAPF32[$35>>2] = $135;
  $136 = $78 * $125;
  $137 = $82 * $126;
  $138 = $136 + $137;
  $139 = $86 * $127;
  $140 = $138 + $139;
  $141 = $90 * $128;
  $142 = $140 + $141;
  HEAPF32[$36>>2] = $142;
  $143 = $79 * $125;
  $144 = $83 * $126;
  $145 = $143 + $144;
  $146 = $87 * $127;
  $147 = $145 + $146;
  $148 = $91 * $128;
  $149 = $147 + $148;
  HEAPF32[$37>>2] = $149;
  $150 = $80 * $125;
  $151 = $84 * $126;
  $152 = $150 + $151;
  $153 = $88 * $127;
  $154 = $152 + $153;
  $155 = $92 * $128;
  $156 = $154 + $155;
  HEAPF32[$38>>2] = $156;
  $157 = +HEAPF32[$40>>2];
  $158 = +HEAPF32[$41>>2];
  $159 = +HEAPF32[$42>>2];
  $160 = +HEAPF32[$43>>2];
  $161 = $77 * $157;
  $162 = $81 * $158;
  $163 = $161 + $162;
  $164 = $85 * $159;
  $165 = $163 + $164;
  $166 = $89 * $160;
  $167 = $165 + $166;
  HEAPF32[$45>>2] = $167;
  $168 = $78 * $157;
  $169 = $82 * $158;
  $170 = $168 + $169;
  $171 = $86 * $159;
  $172 = $170 + $171;
  $173 = $90 * $160;
  $174 = $172 + $173;
  HEAPF32[$46>>2] = $174;
  $175 = $79 * $157;
  $176 = $83 * $158;
  $177 = $175 + $176;
  $178 = $87 * $159;
  $179 = $177 + $178;
  $180 = $91 * $160;
  $181 = $179 + $180;
  HEAPF32[$47>>2] = $181;
  $182 = $80 * $157;
  $183 = $84 * $158;
  $184 = $182 + $183;
  $185 = $88 * $159;
  $186 = $184 + $185;
  $187 = $92 * $160;
  $188 = $186 + $187;
  HEAPF32[$48>>2] = $188;
  $189 = +HEAPF32[$50>>2];
  $190 = +HEAPF32[$51>>2];
  $191 = +HEAPF32[$52>>2];
  $192 = +HEAPF32[$53>>2];
  $193 = $77 * $189;
  $194 = $81 * $190;
  $195 = $193 + $194;
  $196 = $85 * $191;
  $197 = $195 + $196;
  $198 = $89 * $192;
  $199 = $197 + $198;
  HEAPF32[$55>>2] = $199;
  $200 = $78 * $189;
  $201 = $82 * $190;
  $202 = $200 + $201;
  $203 = $86 * $191;
  $204 = $202 + $203;
  $205 = $90 * $192;
  $206 = $204 + $205;
  HEAPF32[$56>>2] = $206;
  $207 = $79 * $189;
  $208 = $83 * $190;
  $209 = $207 + $208;
  $210 = $87 * $191;
  $211 = $209 + $210;
  $212 = $91 * $192;
  $213 = $211 + $212;
  HEAPF32[$57>>2] = $213;
  $214 = $80 * $189;
  $215 = $84 * $190;
  $216 = $214 + $215;
  $217 = $88 * $191;
  $218 = $216 + $217;
  $219 = $92 * $192;
  $220 = $218 + $219;
  HEAPF32[$58>>2] = $220;
  $223 = (_i64Add(($221|0),($222|0),1,0)|0);
  $224 = tempRet0;
  $225 = ($224>>>0)<($1>>>0);
  $226 = ($223>>>0)<($0>>>0);
  $227 = ($224|0)==($1|0);
  $228 = $227 & $226;
  $229 = $225 | $228;
  if ($229) {
   $221 = $223;$222 = $224;
  } else {
   break;
  }
 }
 $65 = (_i64Add(($61|0),($64|0),($0|0),($1|0))|0);
 $66 = tempRet0;
 $67 = 4000;
 $68 = $67;
 HEAP32[$68>>2] = $65;
 $69 = (($67) + 4)|0;
 $70 = $69;
 HEAP32[$70>>2] = $66;
 $71 = 4000;
 $72 = $71;
 $73 = HEAP32[$72>>2]|0;
 $74 = (($71) + 4)|0;
 $75 = $74;
 $76 = HEAP32[$75>>2]|0;
 tempRet0 = ($76);
 return ($73|0);
}
function __ZN20MatrixMultiplication10multiply64Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $100 = 0.0, $101 = 0.0, $102 = 0.0, $103 = 0.0, $104 = 0.0, $105 = 0.0, $106 = 0.0, $107 = 0.0, $108 = 0.0, $109 = 0.0, $11 = 0, $110 = 0.0, $111 = 0.0, $112 = 0.0, $113 = 0.0, $114 = 0.0, $115 = 0.0, $116 = 0.0, $117 = 0.0;
 var $118 = 0.0, $119 = 0.0, $12 = 0, $120 = 0.0, $121 = 0.0, $122 = 0.0, $123 = 0.0, $124 = 0.0, $125 = 0.0, $126 = 0.0, $127 = 0.0, $128 = 0.0, $129 = 0.0, $13 = 0, $130 = 0.0, $131 = 0.0, $132 = 0.0, $133 = 0.0, $134 = 0.0, $135 = 0.0;
 var $136 = 0.0, $137 = 0.0, $138 = 0.0, $139 = 0.0, $14 = 0, $140 = 0.0, $141 = 0.0, $142 = 0.0, $143 = 0.0, $144 = 0.0, $145 = 0.0, $146 = 0.0, $147 = 0.0, $148 = 0.0, $149 = 0.0, $15 = 0, $150 = 0.0, $151 = 0.0, $152 = 0.0, $153 = 0.0;
 var $154 = 0.0, $155 = 0.0, $156 = 0.0, $157 = 0.0, $158 = 0.0, $159 = 0.0, $16 = 0, $160 = 0.0, $161 = 0.0, $162 = 0.0, $163 = 0.0, $164 = 0.0, $165 = 0.0, $166 = 0.0, $167 = 0.0, $168 = 0.0, $169 = 0.0, $17 = 0, $170 = 0.0, $171 = 0.0;
 var $172 = 0.0, $173 = 0.0, $174 = 0.0, $175 = 0.0, $176 = 0.0, $177 = 0.0, $178 = 0.0, $179 = 0.0, $18 = 0, $180 = 0.0, $181 = 0.0, $182 = 0.0, $183 = 0.0, $184 = 0.0, $185 = 0.0, $186 = 0.0, $187 = 0.0, $188 = 0.0, $189 = 0.0, $19 = 0;
 var $190 = 0.0, $191 = 0.0, $192 = 0.0, $193 = 0.0, $194 = 0.0, $195 = 0.0, $196 = 0.0, $197 = 0.0, $198 = 0.0, $199 = 0.0, $2 = 0, $20 = 0, $200 = 0.0, $201 = 0.0, $202 = 0.0, $203 = 0.0, $204 = 0.0, $205 = 0.0, $206 = 0.0, $207 = 0.0;
 var $208 = 0.0, $209 = 0.0, $21 = 0, $210 = 0.0, $211 = 0.0, $212 = 0.0, $213 = 0.0, $214 = 0.0, $215 = 0.0, $216 = 0.0, $217 = 0.0, $218 = 0.0, $219 = 0.0, $22 = 0, $220 = 0.0, $221 = 0.0, $222 = 0.0, $223 = 0.0, $224 = 0.0, $225 = 0.0;
 var $226 = 0.0, $227 = 0.0, $228 = 0.0, $229 = 0.0, $23 = 0, $230 = 0.0, $231 = 0.0, $232 = 0.0, $233 = 0.0, $234 = 0.0, $235 = 0.0, $236 = 0.0, $237 = 0.0, $238 = 0.0, $239 = 0.0, $24 = 0, $240 = 0.0, $241 = 0.0, $242 = 0.0, $243 = 0.0;
 var $244 = 0.0, $245 = 0.0, $246 = 0.0, $247 = 0.0, $248 = 0.0, $249 = 0.0, $25 = 0, $250 = 0.0, $251 = 0.0, $252 = 0.0, $253 = 0.0, $254 = 0.0, $255 = 0.0, $256 = 0.0, $257 = 0.0, $258 = 0.0, $259 = 0.0, $26 = 0, $260 = 0.0, $261 = 0.0;
 var $262 = 0.0, $263 = 0.0, $264 = 0.0, $265 = 0.0, $266 = 0.0, $267 = 0.0, $268 = 0.0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $28 = 0, $29 = 0, $3 = 0;
 var $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0;
 var $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0;
 var $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0.0, $78 = 0.0, $79 = 0.0, $8 = 0, $80 = 0.0, $81 = 0.0, $82 = 0.0, $83 = 0.0, $84 = 0.0;
 var $85 = 0.0, $86 = 0.0, $87 = 0.0, $88 = 0.0, $89 = 0.0, $9 = 0, $90 = 0.0, $91 = 0.0, $92 = 0.0, $93 = 0.0, $94 = 0.0, $95 = 0.0, $96 = 0.0, $97 = 0.0, $98 = 0.0, $99 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $71 = 4000;
  $72 = $71;
  $73 = HEAP32[$72>>2]|0;
  $74 = (($71) + 4)|0;
  $75 = $74;
  $76 = HEAP32[$75>>2]|0;
  tempRet0 = ($76);
  return ($73|0);
 }
 $5 = HEAP32[11008]|0;
 $6 = ((($5)) + 4|0);
 $7 = ((($5)) + 8|0);
 $8 = ((($5)) + 12|0);
 $9 = ((($5)) + 16|0);
 $10 = ((($5)) + 20|0);
 $11 = ((($5)) + 24|0);
 $12 = ((($5)) + 28|0);
 $13 = ((($5)) + 32|0);
 $14 = ((($5)) + 36|0);
 $15 = ((($5)) + 40|0);
 $16 = ((($5)) + 44|0);
 $17 = ((($5)) + 48|0);
 $18 = ((($5)) + 52|0);
 $19 = ((($5)) + 56|0);
 $20 = ((($5)) + 60|0);
 $21 = HEAP32[11009]|0;
 $22 = ((($21)) + 4|0);
 $23 = ((($21)) + 8|0);
 $24 = ((($21)) + 12|0);
 $25 = HEAP32[11012]|0;
 $26 = ((($25)) + 4|0);
 $27 = ((($25)) + 8|0);
 $28 = ((($25)) + 12|0);
 $29 = HEAP32[11009]|0;
 $30 = ((($29)) + 16|0);
 $31 = ((($29)) + 20|0);
 $32 = ((($29)) + 24|0);
 $33 = ((($29)) + 28|0);
 $34 = HEAP32[11012]|0;
 $35 = ((($34)) + 16|0);
 $36 = ((($34)) + 20|0);
 $37 = ((($34)) + 24|0);
 $38 = ((($34)) + 28|0);
 $39 = HEAP32[11009]|0;
 $40 = ((($39)) + 32|0);
 $41 = ((($39)) + 36|0);
 $42 = ((($39)) + 40|0);
 $43 = ((($39)) + 44|0);
 $44 = HEAP32[11012]|0;
 $45 = ((($44)) + 32|0);
 $46 = ((($44)) + 36|0);
 $47 = ((($44)) + 40|0);
 $48 = ((($44)) + 44|0);
 $49 = HEAP32[11009]|0;
 $50 = ((($49)) + 48|0);
 $51 = ((($49)) + 52|0);
 $52 = ((($49)) + 56|0);
 $53 = ((($49)) + 60|0);
 $54 = HEAP32[11012]|0;
 $55 = ((($54)) + 48|0);
 $56 = ((($54)) + 52|0);
 $57 = ((($54)) + 56|0);
 $58 = ((($54)) + 60|0);
 $59 = 4000;
 $60 = $59;
 $61 = HEAP32[$60>>2]|0;
 $62 = (($59) + 4)|0;
 $63 = $62;
 $64 = HEAP32[$63>>2]|0;
 $269 = 0;$270 = 0;
 while(1) {
  $77 = +HEAPF32[$5>>2];
  $78 = $77;
  $79 = +HEAPF32[$6>>2];
  $80 = $79;
  $81 = +HEAPF32[$7>>2];
  $82 = $81;
  $83 = +HEAPF32[$8>>2];
  $84 = $83;
  $85 = +HEAPF32[$9>>2];
  $86 = $85;
  $87 = +HEAPF32[$10>>2];
  $88 = $87;
  $89 = +HEAPF32[$11>>2];
  $90 = $89;
  $91 = +HEAPF32[$12>>2];
  $92 = $91;
  $93 = +HEAPF32[$13>>2];
  $94 = $93;
  $95 = +HEAPF32[$14>>2];
  $96 = $95;
  $97 = +HEAPF32[$15>>2];
  $98 = $97;
  $99 = +HEAPF32[$16>>2];
  $100 = $99;
  $101 = +HEAPF32[$17>>2];
  $102 = $101;
  $103 = +HEAPF32[$18>>2];
  $104 = $103;
  $105 = +HEAPF32[$19>>2];
  $106 = $105;
  $107 = +HEAPF32[$20>>2];
  $108 = $107;
  $109 = +HEAPF32[$21>>2];
  $110 = $109;
  $111 = +HEAPF32[$22>>2];
  $112 = $111;
  $113 = +HEAPF32[$23>>2];
  $114 = $113;
  $115 = +HEAPF32[$24>>2];
  $116 = $115;
  $117 = $78 * $110;
  $118 = $86 * $112;
  $119 = $117 + $118;
  $120 = $94 * $114;
  $121 = $119 + $120;
  $122 = $102 * $116;
  $123 = $121 + $122;
  $124 = $123;
  HEAPF32[$25>>2] = $124;
  $125 = $80 * $110;
  $126 = $88 * $112;
  $127 = $125 + $126;
  $128 = $96 * $114;
  $129 = $127 + $128;
  $130 = $104 * $116;
  $131 = $129 + $130;
  $132 = $131;
  HEAPF32[$26>>2] = $132;
  $133 = $82 * $110;
  $134 = $90 * $112;
  $135 = $133 + $134;
  $136 = $98 * $114;
  $137 = $135 + $136;
  $138 = $106 * $116;
  $139 = $137 + $138;
  $140 = $139;
  HEAPF32[$27>>2] = $140;
  $141 = $84 * $110;
  $142 = $92 * $112;
  $143 = $141 + $142;
  $144 = $100 * $114;
  $145 = $143 + $144;
  $146 = $108 * $116;
  $147 = $145 + $146;
  $148 = $147;
  HEAPF32[$28>>2] = $148;
  $149 = +HEAPF32[$30>>2];
  $150 = $149;
  $151 = +HEAPF32[$31>>2];
  $152 = $151;
  $153 = +HEAPF32[$32>>2];
  $154 = $153;
  $155 = +HEAPF32[$33>>2];
  $156 = $155;
  $157 = $78 * $150;
  $158 = $86 * $152;
  $159 = $157 + $158;
  $160 = $94 * $154;
  $161 = $159 + $160;
  $162 = $102 * $156;
  $163 = $161 + $162;
  $164 = $163;
  HEAPF32[$35>>2] = $164;
  $165 = $80 * $150;
  $166 = $88 * $152;
  $167 = $165 + $166;
  $168 = $96 * $154;
  $169 = $167 + $168;
  $170 = $104 * $156;
  $171 = $169 + $170;
  $172 = $171;
  HEAPF32[$36>>2] = $172;
  $173 = $82 * $150;
  $174 = $90 * $152;
  $175 = $173 + $174;
  $176 = $98 * $154;
  $177 = $175 + $176;
  $178 = $106 * $156;
  $179 = $177 + $178;
  $180 = $179;
  HEAPF32[$37>>2] = $180;
  $181 = $84 * $150;
  $182 = $92 * $152;
  $183 = $181 + $182;
  $184 = $100 * $154;
  $185 = $183 + $184;
  $186 = $108 * $156;
  $187 = $185 + $186;
  $188 = $187;
  HEAPF32[$38>>2] = $188;
  $189 = +HEAPF32[$40>>2];
  $190 = $189;
  $191 = +HEAPF32[$41>>2];
  $192 = $191;
  $193 = +HEAPF32[$42>>2];
  $194 = $193;
  $195 = +HEAPF32[$43>>2];
  $196 = $195;
  $197 = $78 * $190;
  $198 = $86 * $192;
  $199 = $197 + $198;
  $200 = $94 * $194;
  $201 = $199 + $200;
  $202 = $102 * $196;
  $203 = $201 + $202;
  $204 = $203;
  HEAPF32[$45>>2] = $204;
  $205 = $80 * $190;
  $206 = $88 * $192;
  $207 = $205 + $206;
  $208 = $96 * $194;
  $209 = $207 + $208;
  $210 = $104 * $196;
  $211 = $209 + $210;
  $212 = $211;
  HEAPF32[$46>>2] = $212;
  $213 = $82 * $190;
  $214 = $90 * $192;
  $215 = $213 + $214;
  $216 = $98 * $194;
  $217 = $215 + $216;
  $218 = $106 * $196;
  $219 = $217 + $218;
  $220 = $219;
  HEAPF32[$47>>2] = $220;
  $221 = $84 * $190;
  $222 = $92 * $192;
  $223 = $221 + $222;
  $224 = $100 * $194;
  $225 = $223 + $224;
  $226 = $108 * $196;
  $227 = $225 + $226;
  $228 = $227;
  HEAPF32[$48>>2] = $228;
  $229 = +HEAPF32[$50>>2];
  $230 = $229;
  $231 = +HEAPF32[$51>>2];
  $232 = $231;
  $233 = +HEAPF32[$52>>2];
  $234 = $233;
  $235 = +HEAPF32[$53>>2];
  $236 = $235;
  $237 = $78 * $230;
  $238 = $86 * $232;
  $239 = $237 + $238;
  $240 = $94 * $234;
  $241 = $239 + $240;
  $242 = $102 * $236;
  $243 = $241 + $242;
  $244 = $243;
  HEAPF32[$55>>2] = $244;
  $245 = $80 * $230;
  $246 = $88 * $232;
  $247 = $245 + $246;
  $248 = $96 * $234;
  $249 = $247 + $248;
  $250 = $104 * $236;
  $251 = $249 + $250;
  $252 = $251;
  HEAPF32[$56>>2] = $252;
  $253 = $82 * $230;
  $254 = $90 * $232;
  $255 = $253 + $254;
  $256 = $98 * $234;
  $257 = $255 + $256;
  $258 = $106 * $236;
  $259 = $257 + $258;
  $260 = $259;
  HEAPF32[$57>>2] = $260;
  $261 = $84 * $230;
  $262 = $92 * $232;
  $263 = $261 + $262;
  $264 = $100 * $234;
  $265 = $263 + $264;
  $266 = $108 * $236;
  $267 = $265 + $266;
  $268 = $267;
  HEAPF32[$58>>2] = $268;
  $271 = (_i64Add(($269|0),($270|0),1,0)|0);
  $272 = tempRet0;
  $273 = ($272>>>0)<($1>>>0);
  $274 = ($271>>>0)<($0>>>0);
  $275 = ($272|0)==($1|0);
  $276 = $275 & $274;
  $277 = $273 | $276;
  if ($277) {
   $269 = $271;$270 = $272;
  } else {
   break;
  }
 }
 $65 = (_i64Add(($61|0),($64|0),($0|0),($1|0))|0);
 $66 = tempRet0;
 $67 = 4000;
 $68 = $67;
 HEAP32[$68>>2] = $65;
 $69 = (($67) + 4)|0;
 $70 = $69;
 HEAP32[$70>>2] = $66;
 $71 = 4000;
 $72 = $71;
 $73 = HEAP32[$72>>2]|0;
 $74 = (($71) + 4)|0;
 $75 = $74;
 $76 = HEAP32[$75>>2]|0;
 tempRet0 = ($76);
 return ($73|0);
}
function __ZN20MatrixMultiplication6equalsEPKfS1_($t1,$t2) {
 $t1 = $t1|0;
 $t2 = $t2|0;
 var $0 = 0.0, $1 = 0.0, $10 = 0, $11 = 0.0, $12 = 0, $13 = 0, $14 = 0.0, $15 = 0, $16 = 0.0, $17 = 0, $18 = 0, $19 = 0.0, $2 = 0, $20 = 0, $21 = 0.0, $22 = 0, $23 = 0, $24 = 0.0, $25 = 0, $26 = 0.0;
 var $27 = 0, $28 = 0, $29 = 0.0, $3 = 0, $30 = 0, $31 = 0.0, $32 = 0, $33 = 0, $34 = 0.0, $35 = 0, $36 = 0.0, $37 = 0, $38 = 0, $39 = 0.0, $4 = 0.0, $40 = 0, $41 = 0.0, $42 = 0, $43 = 0, $44 = 0.0;
 var $45 = 0, $46 = 0.0, $47 = 0, $48 = 0, $49 = 0.0, $5 = 0, $50 = 0, $51 = 0.0, $52 = 0, $53 = 0, $54 = 0.0, $55 = 0, $56 = 0.0, $57 = 0, $58 = 0, $59 = 0.0, $6 = 0.0, $60 = 0, $61 = 0.0, $62 = 0;
 var $63 = 0, $64 = 0.0, $65 = 0, $66 = 0.0, $67 = 0, $68 = 0, $69 = 0.0, $7 = 0, $70 = 0, $71 = 0.0, $72 = 0, $73 = 0, $74 = 0.0, $75 = 0, $76 = 0.0, $77 = 0, $78 = 0, $8 = 0, $9 = 0.0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $0 = +HEAPF32[$t1>>2];
 $1 = +HEAPF32[$t2>>2];
 $2 = $0 == $1;
 if (!($2)) {
  $78 = 0;
  return ($78|0);
 }
 $3 = ((($t1)) + 4|0);
 $4 = +HEAPF32[$3>>2];
 $5 = ((($t2)) + 4|0);
 $6 = +HEAPF32[$5>>2];
 $7 = $4 == $6;
 if (!($7)) {
  $78 = 0;
  return ($78|0);
 }
 $8 = ((($t1)) + 8|0);
 $9 = +HEAPF32[$8>>2];
 $10 = ((($t2)) + 8|0);
 $11 = +HEAPF32[$10>>2];
 $12 = $9 == $11;
 if (!($12)) {
  $78 = 0;
  return ($78|0);
 }
 $13 = ((($t1)) + 12|0);
 $14 = +HEAPF32[$13>>2];
 $15 = ((($t2)) + 12|0);
 $16 = +HEAPF32[$15>>2];
 $17 = $14 == $16;
 if (!($17)) {
  $78 = 0;
  return ($78|0);
 }
 $18 = ((($t1)) + 16|0);
 $19 = +HEAPF32[$18>>2];
 $20 = ((($t2)) + 16|0);
 $21 = +HEAPF32[$20>>2];
 $22 = $19 == $21;
 if (!($22)) {
  $78 = 0;
  return ($78|0);
 }
 $23 = ((($t1)) + 20|0);
 $24 = +HEAPF32[$23>>2];
 $25 = ((($t2)) + 20|0);
 $26 = +HEAPF32[$25>>2];
 $27 = $24 == $26;
 if (!($27)) {
  $78 = 0;
  return ($78|0);
 }
 $28 = ((($t1)) + 24|0);
 $29 = +HEAPF32[$28>>2];
 $30 = ((($t2)) + 24|0);
 $31 = +HEAPF32[$30>>2];
 $32 = $29 == $31;
 if (!($32)) {
  $78 = 0;
  return ($78|0);
 }
 $33 = ((($t1)) + 28|0);
 $34 = +HEAPF32[$33>>2];
 $35 = ((($t2)) + 28|0);
 $36 = +HEAPF32[$35>>2];
 $37 = $34 == $36;
 if (!($37)) {
  $78 = 0;
  return ($78|0);
 }
 $38 = ((($t1)) + 32|0);
 $39 = +HEAPF32[$38>>2];
 $40 = ((($t2)) + 32|0);
 $41 = +HEAPF32[$40>>2];
 $42 = $39 == $41;
 if (!($42)) {
  $78 = 0;
  return ($78|0);
 }
 $43 = ((($t1)) + 36|0);
 $44 = +HEAPF32[$43>>2];
 $45 = ((($t2)) + 36|0);
 $46 = +HEAPF32[$45>>2];
 $47 = $44 == $46;
 if (!($47)) {
  $78 = 0;
  return ($78|0);
 }
 $48 = ((($t1)) + 40|0);
 $49 = +HEAPF32[$48>>2];
 $50 = ((($t2)) + 40|0);
 $51 = +HEAPF32[$50>>2];
 $52 = $49 == $51;
 if (!($52)) {
  $78 = 0;
  return ($78|0);
 }
 $53 = ((($t1)) + 44|0);
 $54 = +HEAPF32[$53>>2];
 $55 = ((($t2)) + 44|0);
 $56 = +HEAPF32[$55>>2];
 $57 = $54 == $56;
 if (!($57)) {
  $78 = 0;
  return ($78|0);
 }
 $58 = ((($t1)) + 48|0);
 $59 = +HEAPF32[$58>>2];
 $60 = ((($t2)) + 48|0);
 $61 = +HEAPF32[$60>>2];
 $62 = $59 == $61;
 if (!($62)) {
  $78 = 0;
  return ($78|0);
 }
 $63 = ((($t1)) + 52|0);
 $64 = +HEAPF32[$63>>2];
 $65 = ((($t2)) + 52|0);
 $66 = +HEAPF32[$65>>2];
 $67 = $64 == $66;
 if (!($67)) {
  $78 = 0;
  return ($78|0);
 }
 $68 = ((($t1)) + 56|0);
 $69 = +HEAPF32[$68>>2];
 $70 = ((($t2)) + 56|0);
 $71 = +HEAPF32[$70>>2];
 $72 = $69 == $71;
 if (!($72)) {
  $78 = 0;
  return ($78|0);
 }
 $73 = ((($t1)) + 60|0);
 $74 = +HEAPF32[$73>>2];
 $75 = ((($t2)) + 60|0);
 $76 = +HEAPF32[$75>>2];
 $77 = $74 == $76;
 $78 = $77;
 return ($78|0);
}
function __ZN15VertexTransform4initEv() {
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 $0 = (__Znaj(64)|0);
 HEAP32[11014] = $0;
 $1 = (__Znaj(16)|0);
 HEAP32[11015] = $1;
 $2 = (__Znaj(16)|0);
 HEAP32[11016] = $2;
 $3 = (__Znaj(64)|0);
 HEAP32[11017] = $3;
 $4 = (__Znaj(16)|0);
 HEAP32[11018] = $4;
 $5 = (__Znaj(16)|0);
 HEAP32[11019] = $5;
 $6 = HEAP32[11014]|0;
 HEAPF32[$6>>2] = 1.0;
 $7 = HEAP32[11014]|0;
 $8 = ((($7)) + 20|0);
 HEAPF32[$8>>2] = 1.0;
 $9 = HEAP32[11014]|0;
 $10 = ((($9)) + 40|0);
 HEAPF32[$10>>2] = 1.0;
 $11 = HEAP32[11014]|0;
 $12 = ((($11)) + 60|0);
 HEAPF32[$12>>2] = 1.0;
 $13 = HEAP32[11015]|0;
 HEAPF32[$13>>2] = 1.0;
 $14 = HEAP32[11015]|0;
 $15 = ((($14)) + 4|0);
 HEAPF32[$15>>2] = 2.0;
 $16 = HEAP32[11015]|0;
 $17 = ((($16)) + 8|0);
 HEAPF32[$17>>2] = 3.0;
 $18 = HEAP32[11015]|0;
 $19 = ((($18)) + 12|0);
 HEAPF32[$19>>2] = 1.0;
 $20 = HEAP32[11017]|0;
 dest=$20; stop=dest+64|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 HEAPF32[$20>>2] = 1.0;
 $21 = HEAP32[11017]|0;
 $22 = ((($21)) + 20|0);
 HEAPF32[$22>>2] = 1.0;
 $23 = HEAP32[11017]|0;
 $24 = ((($23)) + 40|0);
 HEAPF32[$24>>2] = 1.0;
 $25 = HEAP32[11017]|0;
 $26 = ((($25)) + 60|0);
 HEAPF32[$26>>2] = 1.0;
 $27 = HEAP32[11018]|0;
 HEAPF32[$27>>2] = 1.0;
 $28 = HEAP32[11018]|0;
 $29 = ((($28)) + 4|0);
 HEAPF32[$29>>2] = 2.0;
 $30 = HEAP32[11018]|0;
 $31 = ((($30)) + 8|0);
 HEAPF32[$31>>2] = 3.0;
 $32 = HEAP32[11018]|0;
 $33 = ((($32)) + 12|0);
 HEAPF32[$33>>2] = 1.0;
 (__ZN15VertexTransform20simdVertextTransformEy(1,0)|0);
 $34 = tempRet0;
 (__ZN15VertexTransform18vertextTransform32Ey(1,0)|0);
 $35 = tempRet0;
 return 1;
}
function __ZN15VertexTransform7cleanupEv() {
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $5 = 0, $6 = 0, $7 = 0;
 var $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[11014]|0;
 HEAPF32[$0>>2] = 1.0;
 $1 = HEAP32[11014]|0;
 $2 = ((($1)) + 20|0);
 HEAPF32[$2>>2] = 1.0;
 $3 = HEAP32[11014]|0;
 $4 = ((($3)) + 40|0);
 HEAPF32[$4>>2] = 1.0;
 $5 = HEAP32[11014]|0;
 $6 = ((($5)) + 60|0);
 HEAPF32[$6>>2] = 1.0;
 $7 = HEAP32[11015]|0;
 HEAPF32[$7>>2] = 1.0;
 $8 = HEAP32[11015]|0;
 $9 = ((($8)) + 4|0);
 HEAPF32[$9>>2] = 2.0;
 $10 = HEAP32[11015]|0;
 $11 = ((($10)) + 8|0);
 HEAPF32[$11>>2] = 3.0;
 $12 = HEAP32[11015]|0;
 $13 = ((($12)) + 12|0);
 HEAPF32[$13>>2] = 1.0;
 $14 = HEAP32[11017]|0;
 HEAPF32[$14>>2] = 1.0;
 $15 = HEAP32[11017]|0;
 $16 = ((($15)) + 20|0);
 HEAPF32[$16>>2] = 1.0;
 $17 = HEAP32[11017]|0;
 $18 = ((($17)) + 40|0);
 HEAPF32[$18>>2] = 1.0;
 $19 = HEAP32[11017]|0;
 $20 = ((($19)) + 60|0);
 HEAPF32[$20>>2] = 1.0;
 $21 = HEAP32[11018]|0;
 HEAPF32[$21>>2] = 1.0;
 $22 = HEAP32[11018]|0;
 $23 = ((($22)) + 4|0);
 HEAPF32[$23>>2] = 2.0;
 $24 = HEAP32[11018]|0;
 $25 = ((($24)) + 8|0);
 HEAPF32[$25>>2] = 3.0;
 $26 = HEAP32[11018]|0;
 $27 = ((($26)) + 12|0);
 HEAPF32[$27>>2] = 1.0;
 (__ZN15VertexTransform20simdVertextTransformEy(1,0)|0);
 $28 = tempRet0;
 (__ZN15VertexTransform18vertextTransform32Ey(1,0)|0);
 $29 = tempRet0;
 $30 = HEAP32[11014]|0;
 $31 = ($30|0)==(0|0);
 if (!($31)) {
  __ZdaPv($30);
 }
 $32 = HEAP32[11015]|0;
 $33 = ($32|0)==(0|0);
 if (!($33)) {
  __ZdaPv($32);
 }
 $34 = HEAP32[11016]|0;
 $35 = ($34|0)==(0|0);
 if (!($35)) {
  __ZdaPv($34);
 }
 $36 = HEAP32[11017]|0;
 $37 = ($36|0)==(0|0);
 if (!($37)) {
  __ZdaPv($36);
 }
 $38 = HEAP32[11018]|0;
 $39 = ($38|0)==(0|0);
 if (!($39)) {
  __ZdaPv($38);
 }
 $40 = HEAP32[11019]|0;
 $41 = ($40|0)==(0|0);
 if ($41) {
  return 1;
 }
 __ZdaPv($40);
 return 1;
}
function __ZN15VertexTransform20simdVertextTransformEy($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $29 = 0, $3 = 0, $30 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $31 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $32 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $33 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $34 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $35 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $36 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $37 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $38 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $39 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $4 = 0, $40 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $41 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $42 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $43 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $44 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $45 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $46 = SIMD_Float32x4(0.0,0.0,0.0,0.0);
 var $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0, temp_Float32x4_ptr = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $24 = 4008;
  $25 = $24;
  $26 = HEAP32[$25>>2]|0;
  $27 = (($24) + 4)|0;
  $28 = $27;
  $29 = HEAP32[$28>>2]|0;
  tempRet0 = ($29);
  return ($26|0);
 }
 $5 = HEAP32[11018]|0;
 $6 = HEAP32[11017]|0;
 $7 = HEAP32[11019]|0;
 $8 = ((($6)) + 16|0);
 $9 = ((($6)) + 32|0);
 $10 = ((($6)) + 48|0);
 $11 = HEAP32[11019]|0;
 $12 = 4008;
 $13 = $12;
 $14 = HEAP32[$13>>2]|0;
 $15 = (($12) + 4)|0;
 $16 = $15;
 $17 = HEAP32[$16>>2]|0;
 $47 = 0;$48 = 0;
 while(1) {
  $30 = SIMD_Float32x4_load(HEAPU8, $5);
  $31 = SIMD_Float32x4_swizzle($30, 0, 0, 0, 0);
  $32 = SIMD_Float32x4_load(HEAPU8, $6);
  $33 = SIMD_Float32x4_mul($31,$32);
  $34 = SIMD_Float32x4_add($33,SIMD_Float32x4_splat(Math_fround(0)));
  temp_Float32x4_ptr = $7;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $34);
  $35 = SIMD_Float32x4_swizzle($30, 1, 1, 1, 1);
  $36 = SIMD_Float32x4_load(HEAPU8, $8);
  $37 = SIMD_Float32x4_mul($35,$36);
  $38 = SIMD_Float32x4_add($34,$37);
  temp_Float32x4_ptr = $7;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $38);
  $39 = SIMD_Float32x4_swizzle($30, 2, 2, 2, 2);
  $40 = SIMD_Float32x4_load(HEAPU8, $9);
  $41 = SIMD_Float32x4_mul($39,$40);
  $42 = SIMD_Float32x4_add($38,$41);
  $43 = SIMD_Float32x4_swizzle($30, 3, 3, 3, 3);
  $44 = SIMD_Float32x4_load(HEAPU8, $10);
  $45 = SIMD_Float32x4_mul($43,$44);
  $46 = SIMD_Float32x4_add($42,$45);
  temp_Float32x4_ptr = $11;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $46);
  $49 = (_i64Add(($47|0),($48|0),1,0)|0);
  $50 = tempRet0;
  $51 = ($50>>>0)<($1>>>0);
  $52 = ($49>>>0)<($0>>>0);
  $53 = ($50|0)==($1|0);
  $54 = $53 & $52;
  $55 = $51 | $54;
  if ($55) {
   $47 = $49;$48 = $50;
  } else {
   break;
  }
 }
 $18 = (_i64Add(($14|0),($17|0),($0|0),($1|0))|0);
 $19 = tempRet0;
 $20 = 4008;
 $21 = $20;
 HEAP32[$21>>2] = $18;
 $22 = (($20) + 4)|0;
 $23 = $22;
 HEAP32[$23>>2] = $19;
 $24 = 4008;
 $25 = $24;
 $26 = HEAP32[$25>>2]|0;
 $27 = (($24) + 4)|0;
 $28 = $27;
 $29 = HEAP32[$28>>2]|0;
 tempRet0 = ($29);
 return ($26|0);
}
function __ZN15VertexTransform18vertextTransform32Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0;
 var $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0;
 var $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0.0, $52 = 0.0, $53 = 0.0, $54 = 0.0, $55 = 0.0, $56 = 0.0, $57 = 0.0;
 var $58 = 0.0, $59 = 0.0, $6 = 0, $60 = 0.0, $61 = 0.0, $62 = 0.0, $63 = 0.0, $64 = 0.0, $65 = 0.0, $66 = 0.0, $67 = 0.0, $68 = 0.0, $69 = 0.0, $7 = 0, $70 = 0.0, $71 = 0.0, $72 = 0.0, $73 = 0.0, $74 = 0.0, $75 = 0.0;
 var $76 = 0.0, $77 = 0.0, $78 = 0.0, $79 = 0.0, $8 = 0, $80 = 0.0, $81 = 0.0, $82 = 0.0, $83 = 0.0, $84 = 0.0, $85 = 0.0, $86 = 0.0, $87 = 0.0, $88 = 0.0, $89 = 0.0, $9 = 0, $90 = 0.0, $91 = 0.0, $92 = 0.0, $93 = 0.0;
 var $94 = 0.0, $95 = 0.0, $96 = 0.0, $97 = 0.0, $98 = 0.0, $99 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $45 = 4008;
  $46 = $45;
  $47 = HEAP32[$46>>2]|0;
  $48 = (($45) + 4)|0;
  $49 = $48;
  $50 = HEAP32[$49>>2]|0;
  tempRet0 = ($50);
  return ($47|0);
 }
 $5 = HEAP32[11015]|0;
 $6 = ((($5)) + 4|0);
 $7 = ((($5)) + 8|0);
 $8 = ((($5)) + 12|0);
 $9 = HEAP32[11014]|0;
 $10 = ((($9)) + 16|0);
 $11 = ((($9)) + 32|0);
 $12 = ((($9)) + 48|0);
 $13 = HEAP32[11016]|0;
 $14 = ((($9)) + 4|0);
 $15 = ((($9)) + 20|0);
 $16 = ((($9)) + 36|0);
 $17 = ((($9)) + 52|0);
 $18 = ((($13)) + 4|0);
 $19 = HEAP32[11014]|0;
 $20 = ((($19)) + 8|0);
 $21 = ((($19)) + 24|0);
 $22 = ((($19)) + 40|0);
 $23 = ((($19)) + 56|0);
 $24 = HEAP32[11016]|0;
 $25 = ((($24)) + 8|0);
 $26 = HEAP32[11014]|0;
 $27 = ((($26)) + 12|0);
 $28 = ((($26)) + 28|0);
 $29 = ((($26)) + 44|0);
 $30 = ((($26)) + 60|0);
 $31 = HEAP32[11016]|0;
 $32 = ((($31)) + 12|0);
 $33 = 4008;
 $34 = $33;
 $35 = HEAP32[$34>>2]|0;
 $36 = (($33) + 4)|0;
 $37 = $36;
 $38 = HEAP32[$37>>2]|0;
 $100 = 0;$99 = 0;
 while(1) {
  $51 = +HEAPF32[$5>>2];
  $52 = +HEAPF32[$6>>2];
  $53 = +HEAPF32[$7>>2];
  $54 = +HEAPF32[$8>>2];
  $55 = +HEAPF32[$9>>2];
  $56 = +HEAPF32[$10>>2];
  $57 = +HEAPF32[$11>>2];
  $58 = +HEAPF32[$12>>2];
  $59 = $51 * $55;
  $60 = $52 * $56;
  $61 = $59 + $60;
  $62 = $53 * $57;
  $63 = $61 + $62;
  $64 = $54 * $58;
  $65 = $63 + $64;
  HEAPF32[$13>>2] = $65;
  $66 = +HEAPF32[$14>>2];
  $67 = +HEAPF32[$15>>2];
  $68 = +HEAPF32[$16>>2];
  $69 = +HEAPF32[$17>>2];
  $70 = $51 * $66;
  $71 = $52 * $67;
  $72 = $70 + $71;
  $73 = $53 * $68;
  $74 = $72 + $73;
  $75 = $54 * $69;
  $76 = $74 + $75;
  HEAPF32[$18>>2] = $76;
  $77 = +HEAPF32[$20>>2];
  $78 = +HEAPF32[$21>>2];
  $79 = +HEAPF32[$22>>2];
  $80 = +HEAPF32[$23>>2];
  $81 = $51 * $77;
  $82 = $52 * $78;
  $83 = $81 + $82;
  $84 = $53 * $79;
  $85 = $83 + $84;
  $86 = $54 * $80;
  $87 = $85 + $86;
  HEAPF32[$25>>2] = $87;
  $88 = +HEAPF32[$27>>2];
  $89 = +HEAPF32[$28>>2];
  $90 = +HEAPF32[$29>>2];
  $91 = +HEAPF32[$30>>2];
  $92 = $51 * $88;
  $93 = $52 * $89;
  $94 = $92 + $93;
  $95 = $53 * $90;
  $96 = $94 + $95;
  $97 = $54 * $91;
  $98 = $96 + $97;
  HEAPF32[$32>>2] = $98;
  $101 = (_i64Add(($99|0),($100|0),1,0)|0);
  $102 = tempRet0;
  $103 = ($102>>>0)<($1>>>0);
  $104 = ($101>>>0)<($0>>>0);
  $105 = ($102|0)==($1|0);
  $106 = $105 & $104;
  $107 = $103 | $106;
  if ($107) {
   $100 = $102;$99 = $101;
  } else {
   break;
  }
 }
 $39 = (_i64Add(($35|0),($38|0),($0|0),($1|0))|0);
 $40 = tempRet0;
 $41 = 4008;
 $42 = $41;
 HEAP32[$42>>2] = $39;
 $43 = (($41) + 4)|0;
 $44 = $43;
 HEAP32[$44>>2] = $40;
 $45 = 4008;
 $46 = $45;
 $47 = HEAP32[$46>>2]|0;
 $48 = (($45) + 4)|0;
 $49 = $48;
 $50 = HEAP32[$49>>2]|0;
 tempRet0 = ($50);
 return ($47|0);
}
function __ZN15VertexTransform18vertextTransform64Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $100 = 0.0, $101 = 0.0, $102 = 0.0, $103 = 0.0, $104 = 0.0, $105 = 0.0, $106 = 0.0, $107 = 0.0, $108 = 0.0, $109 = 0.0, $11 = 0, $110 = 0.0, $111 = 0.0, $112 = 0.0, $113 = 0.0, $114 = 0.0, $115 = 0.0, $116 = 0.0, $117 = 0.0;
 var $118 = 0.0, $119 = 0.0, $12 = 0, $120 = 0.0, $121 = 0.0, $122 = 0.0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0;
 var $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0;
 var $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0.0, $52 = 0.0, $53 = 0.0;
 var $54 = 0.0, $55 = 0.0, $56 = 0.0, $57 = 0.0, $58 = 0.0, $59 = 0.0, $6 = 0, $60 = 0.0, $61 = 0.0, $62 = 0.0, $63 = 0.0, $64 = 0.0, $65 = 0.0, $66 = 0.0, $67 = 0.0, $68 = 0.0, $69 = 0.0, $7 = 0, $70 = 0.0, $71 = 0.0;
 var $72 = 0.0, $73 = 0.0, $74 = 0.0, $75 = 0.0, $76 = 0.0, $77 = 0.0, $78 = 0.0, $79 = 0.0, $8 = 0, $80 = 0.0, $81 = 0.0, $82 = 0.0, $83 = 0.0, $84 = 0.0, $85 = 0.0, $86 = 0.0, $87 = 0.0, $88 = 0.0, $89 = 0.0, $9 = 0;
 var $90 = 0.0, $91 = 0.0, $92 = 0.0, $93 = 0.0, $94 = 0.0, $95 = 0.0, $96 = 0.0, $97 = 0.0, $98 = 0.0, $99 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $45 = 4008;
  $46 = $45;
  $47 = HEAP32[$46>>2]|0;
  $48 = (($45) + 4)|0;
  $49 = $48;
  $50 = HEAP32[$49>>2]|0;
  tempRet0 = ($50);
  return ($47|0);
 }
 $5 = HEAP32[11015]|0;
 $6 = ((($5)) + 4|0);
 $7 = ((($5)) + 8|0);
 $8 = ((($5)) + 12|0);
 $9 = HEAP32[11014]|0;
 $10 = ((($9)) + 16|0);
 $11 = ((($9)) + 32|0);
 $12 = ((($9)) + 48|0);
 $13 = HEAP32[11016]|0;
 $14 = ((($9)) + 4|0);
 $15 = ((($9)) + 20|0);
 $16 = ((($9)) + 36|0);
 $17 = ((($9)) + 52|0);
 $18 = ((($13)) + 4|0);
 $19 = HEAP32[11014]|0;
 $20 = ((($19)) + 8|0);
 $21 = ((($19)) + 24|0);
 $22 = ((($19)) + 40|0);
 $23 = ((($19)) + 56|0);
 $24 = HEAP32[11016]|0;
 $25 = ((($24)) + 8|0);
 $26 = HEAP32[11014]|0;
 $27 = ((($26)) + 12|0);
 $28 = ((($26)) + 28|0);
 $29 = ((($26)) + 44|0);
 $30 = ((($26)) + 60|0);
 $31 = HEAP32[11016]|0;
 $32 = ((($31)) + 12|0);
 $33 = 4008;
 $34 = $33;
 $35 = HEAP32[$34>>2]|0;
 $36 = (($33) + 4)|0;
 $37 = $36;
 $38 = HEAP32[$37>>2]|0;
 $123 = 0;$124 = 0;
 while(1) {
  $51 = +HEAPF32[$5>>2];
  $52 = $51;
  $53 = +HEAPF32[$6>>2];
  $54 = $53;
  $55 = +HEAPF32[$7>>2];
  $56 = $55;
  $57 = +HEAPF32[$8>>2];
  $58 = $57;
  $59 = +HEAPF32[$9>>2];
  $60 = $59;
  $61 = +HEAPF32[$10>>2];
  $62 = $61;
  $63 = +HEAPF32[$11>>2];
  $64 = $63;
  $65 = +HEAPF32[$12>>2];
  $66 = $65;
  $67 = $52 * $60;
  $68 = $54 * $62;
  $69 = $67 + $68;
  $70 = $56 * $64;
  $71 = $69 + $70;
  $72 = $58 * $66;
  $73 = $71 + $72;
  $74 = $73;
  HEAPF32[$13>>2] = $74;
  $75 = +HEAPF32[$14>>2];
  $76 = $75;
  $77 = +HEAPF32[$15>>2];
  $78 = $77;
  $79 = +HEAPF32[$16>>2];
  $80 = $79;
  $81 = +HEAPF32[$17>>2];
  $82 = $81;
  $83 = $52 * $76;
  $84 = $54 * $78;
  $85 = $83 + $84;
  $86 = $56 * $80;
  $87 = $85 + $86;
  $88 = $58 * $82;
  $89 = $87 + $88;
  $90 = $89;
  HEAPF32[$18>>2] = $90;
  $91 = +HEAPF32[$20>>2];
  $92 = $91;
  $93 = +HEAPF32[$21>>2];
  $94 = $93;
  $95 = +HEAPF32[$22>>2];
  $96 = $95;
  $97 = +HEAPF32[$23>>2];
  $98 = $97;
  $99 = $52 * $92;
  $100 = $54 * $94;
  $101 = $99 + $100;
  $102 = $56 * $96;
  $103 = $101 + $102;
  $104 = $58 * $98;
  $105 = $103 + $104;
  $106 = $105;
  HEAPF32[$25>>2] = $106;
  $107 = +HEAPF32[$27>>2];
  $108 = $107;
  $109 = +HEAPF32[$28>>2];
  $110 = $109;
  $111 = +HEAPF32[$29>>2];
  $112 = $111;
  $113 = +HEAPF32[$30>>2];
  $114 = $113;
  $115 = $52 * $108;
  $116 = $54 * $110;
  $117 = $115 + $116;
  $118 = $56 * $112;
  $119 = $117 + $118;
  $120 = $58 * $114;
  $121 = $119 + $120;
  $122 = $121;
  HEAPF32[$32>>2] = $122;
  $125 = (_i64Add(($123|0),($124|0),1,0)|0);
  $126 = tempRet0;
  $127 = ($126>>>0)<($1>>>0);
  $128 = ($125>>>0)<($0>>>0);
  $129 = ($126|0)==($1|0);
  $130 = $129 & $128;
  $131 = $127 | $130;
  if ($131) {
   $123 = $125;$124 = $126;
  } else {
   break;
  }
 }
 $39 = (_i64Add(($35|0),($38|0),($0|0),($1|0))|0);
 $40 = tempRet0;
 $41 = 4008;
 $42 = $41;
 HEAP32[$42>>2] = $39;
 $43 = (($41) + 4)|0;
 $44 = $43;
 HEAP32[$44>>2] = $40;
 $45 = 4008;
 $46 = $45;
 $47 = HEAP32[$46>>2]|0;
 $48 = (($45) + 4)|0;
 $49 = $48;
 $50 = HEAP32[$49>>2]|0;
 tempRet0 = ($50);
 return ($47|0);
}
function __ZN15MatrixTranspose4initEv() {
 var $$0 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__Znaj(64)|0);
 HEAP32[11020] = $0;
 HEAP32[11021] = $0;
 $1 = (__Znaj(64)|0);
 HEAP32[11022] = $1;
 HEAP32[11023] = $1;
 $2 = (__Znaj(64)|0);
 HEAP32[11024] = $2;
 HEAP32[11025] = $2;
 $3 = HEAP32[11020]|0;
 __ZN15MatrixTranspose10initMatrixEPfS0_($3,$2);
 (__ZN15MatrixTranspose11transpose32Ey(1,0)|0);
 $4 = tempRet0;
 $5 = HEAP32[11024]|0;
 $6 = HEAP32[11022]|0;
 $7 = (__ZN15MatrixTranspose18compareEqualMatrixEPKfS1_($5,$6)|0);
 if (!($7)) {
  $$0 = 0;
  return ($$0|0);
 }
 (__ZN15MatrixTranspose13simdTransposeEy(1,0)|0);
 $8 = tempRet0;
 $9 = HEAP32[11024]|0;
 $10 = HEAP32[11022]|0;
 $11 = (__ZN15MatrixTranspose18compareEqualMatrixEPKfS1_($9,$10)|0);
 $$0 = $11;
 return ($$0|0);
}
function __ZN15MatrixTranspose7cleanupEv() {
 var $$pr = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $ret$1$off0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[11020]|0;
 $1 = HEAP32[11024]|0;
 __ZN15MatrixTranspose10initMatrixEPfS0_($0,$1);
 (__ZN15MatrixTranspose11transpose32Ey(1,0)|0);
 $2 = tempRet0;
 $3 = HEAP32[11024]|0;
 $4 = HEAP32[11022]|0;
 $5 = (__ZN15MatrixTranspose18compareEqualMatrixEPKfS1_($3,$4)|0);
 (__ZN15MatrixTranspose13simdTransposeEy(1,0)|0);
 $6 = tempRet0;
 $7 = HEAP32[11024]|0;
 $8 = HEAP32[11022]|0;
 $9 = (__ZN15MatrixTranspose18compareEqualMatrixEPKfS1_($7,$8)|0);
 $ret$1$off0 = $5 & $9;
 $10 = HEAP32[11020]|0;
 $11 = ($10|0)==(0|0);
 if ($11) {
  $13 = $8;
 } else {
  __ZdaPv($10);
  $$pr = HEAP32[11022]|0;
  $13 = $$pr;
 }
 $12 = ($13|0)==(0|0);
 if (!($12)) {
  __ZdaPv($13);
 }
 $14 = HEAP32[11024]|0;
 $15 = ($14|0)==(0|0);
 if ($15) {
  return ($ret$1$off0|0);
 }
 __ZdaPv($14);
 return ($ret$1$off0|0);
}
function __ZN15MatrixTranspose13simdTransposeEy($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $29 = 0, $3 = 0, $30 = 0, $31 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $32 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $33 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $34 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $35 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $36 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $37 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $38 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $39 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $4 = 0, $40 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $41 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $42 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $43 = 0, $44 = 0, $45 = 0, $46 = 0;
 var $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0, temp_Float32x4_ptr = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $25 = 4016;
  $26 = $25;
  $27 = HEAP32[$26>>2]|0;
  $28 = (($25) + 4)|0;
  $29 = $28;
  $30 = HEAP32[$29>>2]|0;
  tempRet0 = ($30);
  return ($27|0);
 }
 $5 = HEAP32[11021]|0;
 $6 = ((($5)) + 16|0);
 $7 = ((($5)) + 32|0);
 $8 = ((($5)) + 48|0);
 $9 = HEAP32[11023]|0;
 $10 = ((($9)) + 16|0);
 $11 = ((($9)) + 32|0);
 $12 = ((($9)) + 48|0);
 $13 = 4016;
 $14 = $13;
 $15 = HEAP32[$14>>2]|0;
 $16 = (($13) + 4)|0;
 $17 = $16;
 $18 = HEAP32[$17>>2]|0;
 $43 = 0;$44 = 0;
 while(1) {
  $31 = SIMD_Float32x4_load(HEAPU8, $5);
  $32 = SIMD_Float32x4_load(HEAPU8, $6);
  $33 = SIMD_Float32x4_load(HEAPU8, $7);
  $34 = SIMD_Float32x4_load(HEAPU8, $8);
  $35 = SIMD_Float32x4_shuffle($31, $32, 0, 1, 4, 5);
  $36 = SIMD_Float32x4_shuffle($33, $34, 0, 1, 4, 5);
  $37 = SIMD_Float32x4_shuffle($35, $36, 0, 2, 4, 6);
  $38 = SIMD_Float32x4_shuffle($35, $36, 1, 3, 5, 7);
  $39 = SIMD_Float32x4_shuffle($31, $32, 2, 3, 6, 7);
  $40 = SIMD_Float32x4_shuffle($33, $34, 2, 3, 6, 7);
  $41 = SIMD_Float32x4_shuffle($39, $40, 0, 2, 4, 6);
  $42 = SIMD_Float32x4_shuffle($39, $40, 1, 3, 5, 7);
  temp_Float32x4_ptr = $9;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $37);
  temp_Float32x4_ptr = $10;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $38);
  temp_Float32x4_ptr = $11;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $41);
  temp_Float32x4_ptr = $12;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $42);
  $45 = (_i64Add(($43|0),($44|0),1,0)|0);
  $46 = tempRet0;
  $47 = ($46>>>0)<($1>>>0);
  $48 = ($45>>>0)<($0>>>0);
  $49 = ($46|0)==($1|0);
  $50 = $49 & $48;
  $51 = $47 | $50;
  if ($51) {
   $43 = $45;$44 = $46;
  } else {
   break;
  }
 }
 $19 = (_i64Add(($15|0),($18|0),($0|0),($1|0))|0);
 $20 = tempRet0;
 $21 = 4016;
 $22 = $21;
 HEAP32[$22>>2] = $19;
 $23 = (($21) + 4)|0;
 $24 = $23;
 HEAP32[$24>>2] = $20;
 $25 = 4016;
 $26 = $25;
 $27 = HEAP32[$26>>2]|0;
 $28 = (($25) + 4)|0;
 $29 = $28;
 $30 = HEAP32[$29>>2]|0;
 tempRet0 = ($30);
 return ($27|0);
}
function __ZN15MatrixTranspose11transpose32Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0;
 var $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0;
 var $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0;
 var $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $61 = 4016;
  $62 = $61;
  $63 = HEAP32[$62>>2]|0;
  $64 = (($61) + 4)|0;
  $65 = $64;
  $66 = HEAP32[$65>>2]|0;
  tempRet0 = ($66);
  return ($63|0);
 }
 $5 = HEAP32[11020]|0;
 $6 = HEAP32[11022]|0;
 $7 = ((($5)) + 16|0);
 $8 = ((($6)) + 4|0);
 $9 = ((($5)) + 32|0);
 $10 = ((($6)) + 8|0);
 $11 = ((($5)) + 48|0);
 $12 = ((($6)) + 12|0);
 $13 = HEAP32[11020]|0;
 $14 = ((($13)) + 4|0);
 $15 = HEAP32[11022]|0;
 $16 = ((($15)) + 16|0);
 $17 = ((($13)) + 20|0);
 $18 = ((($15)) + 20|0);
 $19 = HEAP32[11020]|0;
 $20 = ((($19)) + 36|0);
 $21 = HEAP32[11022]|0;
 $22 = ((($21)) + 24|0);
 $23 = ((($19)) + 52|0);
 $24 = ((($21)) + 28|0);
 $25 = HEAP32[11020]|0;
 $26 = ((($25)) + 8|0);
 $27 = HEAP32[11022]|0;
 $28 = ((($27)) + 32|0);
 $29 = ((($25)) + 24|0);
 $30 = ((($27)) + 36|0);
 $31 = HEAP32[11020]|0;
 $32 = ((($31)) + 40|0);
 $33 = HEAP32[11022]|0;
 $34 = ((($33)) + 40|0);
 $35 = ((($31)) + 56|0);
 $36 = ((($33)) + 44|0);
 $37 = HEAP32[11020]|0;
 $38 = ((($37)) + 12|0);
 $39 = HEAP32[11022]|0;
 $40 = ((($39)) + 48|0);
 $41 = ((($37)) + 28|0);
 $42 = ((($39)) + 52|0);
 $43 = HEAP32[11020]|0;
 $44 = ((($43)) + 44|0);
 $45 = HEAP32[11022]|0;
 $46 = ((($45)) + 56|0);
 $47 = ((($43)) + 60|0);
 $48 = ((($45)) + 60|0);
 $49 = 4016;
 $50 = $49;
 $51 = HEAP32[$50>>2]|0;
 $52 = (($49) + 4)|0;
 $53 = $52;
 $54 = HEAP32[$53>>2]|0;
 $83 = 0;$84 = 0;
 while(1) {
  $67 = HEAP32[$5>>2]|0;
  HEAP32[$6>>2] = $67;
  $68 = HEAP32[$7>>2]|0;
  HEAP32[$8>>2] = $68;
  $69 = HEAP32[$9>>2]|0;
  HEAP32[$10>>2] = $69;
  $70 = HEAP32[$11>>2]|0;
  HEAP32[$12>>2] = $70;
  $71 = HEAP32[$14>>2]|0;
  HEAP32[$16>>2] = $71;
  $72 = HEAP32[$17>>2]|0;
  HEAP32[$18>>2] = $72;
  $73 = HEAP32[$20>>2]|0;
  HEAP32[$22>>2] = $73;
  $74 = HEAP32[$23>>2]|0;
  HEAP32[$24>>2] = $74;
  $75 = HEAP32[$26>>2]|0;
  HEAP32[$28>>2] = $75;
  $76 = HEAP32[$29>>2]|0;
  HEAP32[$30>>2] = $76;
  $77 = HEAP32[$32>>2]|0;
  HEAP32[$34>>2] = $77;
  $78 = HEAP32[$35>>2]|0;
  HEAP32[$36>>2] = $78;
  $79 = HEAP32[$38>>2]|0;
  HEAP32[$40>>2] = $79;
  $80 = HEAP32[$41>>2]|0;
  HEAP32[$42>>2] = $80;
  $81 = HEAP32[$44>>2]|0;
  HEAP32[$46>>2] = $81;
  $82 = HEAP32[$47>>2]|0;
  HEAP32[$48>>2] = $82;
  $85 = (_i64Add(($83|0),($84|0),1,0)|0);
  $86 = tempRet0;
  $87 = ($86>>>0)<($1>>>0);
  $88 = ($85>>>0)<($0>>>0);
  $89 = ($86|0)==($1|0);
  $90 = $89 & $88;
  $91 = $87 | $90;
  if ($91) {
   $83 = $85;$84 = $86;
  } else {
   break;
  }
 }
 $55 = (_i64Add(($51|0),($54|0),($0|0),($1|0))|0);
 $56 = tempRet0;
 $57 = 4016;
 $58 = $57;
 HEAP32[$58>>2] = $55;
 $59 = (($57) + 4)|0;
 $60 = $59;
 HEAP32[$60>>2] = $56;
 $61 = 4016;
 $62 = $61;
 $63 = HEAP32[$62>>2]|0;
 $64 = (($61) + 4)|0;
 $65 = $64;
 $66 = HEAP32[$65>>2]|0;
 tempRet0 = ($66);
 return ($63|0);
}
function __ZN15MatrixTranspose11transpose64Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0;
 var $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0;
 var $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0;
 var $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0;
 var $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $61 = 4016;
  $62 = $61;
  $63 = HEAP32[$62>>2]|0;
  $64 = (($61) + 4)|0;
  $65 = $64;
  $66 = HEAP32[$65>>2]|0;
  tempRet0 = ($66);
  return ($63|0);
 }
 $5 = HEAP32[11020]|0;
 $6 = HEAP32[11022]|0;
 $7 = ((($5)) + 16|0);
 $8 = ((($6)) + 4|0);
 $9 = ((($5)) + 32|0);
 $10 = ((($6)) + 8|0);
 $11 = ((($5)) + 48|0);
 $12 = ((($6)) + 12|0);
 $13 = HEAP32[11020]|0;
 $14 = ((($13)) + 4|0);
 $15 = HEAP32[11022]|0;
 $16 = ((($15)) + 16|0);
 $17 = ((($13)) + 20|0);
 $18 = ((($15)) + 20|0);
 $19 = HEAP32[11020]|0;
 $20 = ((($19)) + 36|0);
 $21 = HEAP32[11022]|0;
 $22 = ((($21)) + 24|0);
 $23 = ((($19)) + 52|0);
 $24 = ((($21)) + 28|0);
 $25 = HEAP32[11020]|0;
 $26 = ((($25)) + 8|0);
 $27 = HEAP32[11022]|0;
 $28 = ((($27)) + 32|0);
 $29 = ((($25)) + 24|0);
 $30 = ((($27)) + 36|0);
 $31 = HEAP32[11020]|0;
 $32 = ((($31)) + 40|0);
 $33 = HEAP32[11022]|0;
 $34 = ((($33)) + 40|0);
 $35 = ((($31)) + 56|0);
 $36 = ((($33)) + 44|0);
 $37 = HEAP32[11020]|0;
 $38 = ((($37)) + 12|0);
 $39 = HEAP32[11022]|0;
 $40 = ((($39)) + 48|0);
 $41 = ((($37)) + 28|0);
 $42 = ((($39)) + 52|0);
 $43 = HEAP32[11020]|0;
 $44 = ((($43)) + 44|0);
 $45 = HEAP32[11022]|0;
 $46 = ((($45)) + 56|0);
 $47 = ((($43)) + 60|0);
 $48 = ((($45)) + 60|0);
 $49 = 4016;
 $50 = $49;
 $51 = HEAP32[$50>>2]|0;
 $52 = (($49) + 4)|0;
 $53 = $52;
 $54 = HEAP32[$53>>2]|0;
 $83 = 0;$84 = 0;
 while(1) {
  $67 = HEAP32[$5>>2]|0;
  HEAP32[$6>>2] = $67;
  $68 = HEAP32[$7>>2]|0;
  HEAP32[$8>>2] = $68;
  $69 = HEAP32[$9>>2]|0;
  HEAP32[$10>>2] = $69;
  $70 = HEAP32[$11>>2]|0;
  HEAP32[$12>>2] = $70;
  $71 = HEAP32[$14>>2]|0;
  HEAP32[$16>>2] = $71;
  $72 = HEAP32[$17>>2]|0;
  HEAP32[$18>>2] = $72;
  $73 = HEAP32[$20>>2]|0;
  HEAP32[$22>>2] = $73;
  $74 = HEAP32[$23>>2]|0;
  HEAP32[$24>>2] = $74;
  $75 = HEAP32[$26>>2]|0;
  HEAP32[$28>>2] = $75;
  $76 = HEAP32[$29>>2]|0;
  HEAP32[$30>>2] = $76;
  $77 = HEAP32[$32>>2]|0;
  HEAP32[$34>>2] = $77;
  $78 = HEAP32[$35>>2]|0;
  HEAP32[$36>>2] = $78;
  $79 = HEAP32[$38>>2]|0;
  HEAP32[$40>>2] = $79;
  $80 = HEAP32[$41>>2]|0;
  HEAP32[$42>>2] = $80;
  $81 = HEAP32[$44>>2]|0;
  HEAP32[$46>>2] = $81;
  $82 = HEAP32[$47>>2]|0;
  HEAP32[$48>>2] = $82;
  $85 = (_i64Add(($83|0),($84|0),1,0)|0);
  $86 = tempRet0;
  $87 = ($86>>>0)<($1>>>0);
  $88 = ($85>>>0)<($0>>>0);
  $89 = ($86|0)==($1|0);
  $90 = $89 & $88;
  $91 = $87 | $90;
  if ($91) {
   $83 = $85;$84 = $86;
  } else {
   break;
  }
 }
 $55 = (_i64Add(($51|0),($54|0),($0|0),($1|0))|0);
 $56 = tempRet0;
 $57 = 4016;
 $58 = $57;
 HEAP32[$58>>2] = $55;
 $59 = (($57) + 4)|0;
 $60 = $59;
 HEAP32[$60>>2] = $56;
 $61 = 4016;
 $62 = $61;
 $63 = HEAP32[$62>>2]|0;
 $64 = (($61) + 4)|0;
 $65 = $64;
 $66 = HEAP32[$65>>2]|0;
 tempRet0 = ($66);
 return ($63|0);
}
function __ZN15MatrixTranspose10initMatrixEPfS0_($matrix,$matrixTransposed) {
 $matrix = $matrix|0;
 $matrixTransposed = $matrixTransposed|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAPF32[$matrix>>2] = 0.0;
 HEAPF32[$matrixTransposed>>2] = 0.0;
 $0 = ((($matrix)) + 4|0);
 HEAPF32[$0>>2] = 1.0;
 $1 = ((($matrixTransposed)) + 16|0);
 HEAPF32[$1>>2] = 1.0;
 $2 = ((($matrix)) + 8|0);
 HEAPF32[$2>>2] = 2.0;
 $3 = ((($matrixTransposed)) + 32|0);
 HEAPF32[$3>>2] = 2.0;
 $4 = ((($matrix)) + 12|0);
 HEAPF32[$4>>2] = 3.0;
 $5 = ((($matrixTransposed)) + 48|0);
 HEAPF32[$5>>2] = 3.0;
 $6 = ((($matrix)) + 16|0);
 HEAPF32[$6>>2] = 4.0;
 $7 = ((($matrixTransposed)) + 4|0);
 HEAPF32[$7>>2] = 4.0;
 $8 = ((($matrix)) + 20|0);
 HEAPF32[$8>>2] = 5.0;
 $9 = ((($matrixTransposed)) + 20|0);
 HEAPF32[$9>>2] = 5.0;
 $10 = ((($matrix)) + 24|0);
 HEAPF32[$10>>2] = 6.0;
 $11 = ((($matrixTransposed)) + 36|0);
 HEAPF32[$11>>2] = 6.0;
 $12 = ((($matrix)) + 28|0);
 HEAPF32[$12>>2] = 7.0;
 $13 = ((($matrixTransposed)) + 52|0);
 HEAPF32[$13>>2] = 7.0;
 $14 = ((($matrix)) + 32|0);
 HEAPF32[$14>>2] = 8.0;
 $15 = ((($matrixTransposed)) + 8|0);
 HEAPF32[$15>>2] = 8.0;
 $16 = ((($matrix)) + 36|0);
 HEAPF32[$16>>2] = 9.0;
 $17 = ((($matrixTransposed)) + 24|0);
 HEAPF32[$17>>2] = 9.0;
 $18 = ((($matrix)) + 40|0);
 HEAPF32[$18>>2] = 10.0;
 $19 = ((($matrixTransposed)) + 40|0);
 HEAPF32[$19>>2] = 10.0;
 $20 = ((($matrix)) + 44|0);
 HEAPF32[$20>>2] = 11.0;
 $21 = ((($matrixTransposed)) + 56|0);
 HEAPF32[$21>>2] = 11.0;
 $22 = ((($matrix)) + 48|0);
 HEAPF32[$22>>2] = 12.0;
 $23 = ((($matrixTransposed)) + 12|0);
 HEAPF32[$23>>2] = 12.0;
 $24 = ((($matrix)) + 52|0);
 HEAPF32[$24>>2] = 13.0;
 $25 = ((($matrixTransposed)) + 28|0);
 HEAPF32[$25>>2] = 13.0;
 $26 = ((($matrix)) + 56|0);
 HEAPF32[$26>>2] = 14.0;
 $27 = ((($matrixTransposed)) + 44|0);
 HEAPF32[$27>>2] = 14.0;
 $28 = ((($matrix)) + 60|0);
 HEAPF32[$28>>2] = 15.0;
 $29 = ((($matrixTransposed)) + 60|0);
 HEAPF32[$29>>2] = 15.0;
 return;
}
function __ZN15MatrixTranspose18compareEqualMatrixEPKfS1_($m1,$m2) {
 $m1 = $m1|0;
 $m2 = $m2|0;
 var $0 = 0.0, $1 = 0.0, $10 = 0.0, $11 = 0, $12 = 0.0, $13 = 0, $14 = 0, $15 = 0.0, $16 = 0, $17 = 0.0, $18 = 0, $19 = 0, $2 = 0, $20 = 0.0, $21 = 0, $22 = 0.0, $23 = 0, $24 = 0, $25 = 0.0, $26 = 0;
 var $27 = 0.0, $28 = 0, $29 = 0, $3 = 0, $30 = 0.0, $31 = 0, $32 = 0.0, $33 = 0, $34 = 0, $35 = 0.0, $36 = 0, $37 = 0.0, $38 = 0, $39 = 0, $4 = 0.0, $40 = 0.0, $41 = 0, $42 = 0.0, $43 = 0, $44 = 0;
 var $45 = 0.0, $46 = 0, $47 = 0.0, $48 = 0, $49 = 0, $5 = 0, $50 = 0.0, $51 = 0, $52 = 0.0, $53 = 0, $54 = 0, $55 = 0.0, $56 = 0, $57 = 0.0, $58 = 0, $59 = 0, $6 = 0.0, $60 = 0.0, $61 = 0, $62 = 0.0;
 var $63 = 0, $64 = 0, $65 = 0.0, $66 = 0, $67 = 0.0, $68 = 0, $69 = 0, $7 = 0, $70 = 0.0, $71 = 0, $72 = 0.0, $73 = 0, $74 = 0, $75 = 0.0, $76 = 0, $77 = 0.0, $78 = 0, $8 = 0, $9 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $0 = +HEAPF32[$m1>>2];
 $1 = +HEAPF32[$m2>>2];
 $2 = $0 != $1;
 if ($2) {
  $8 = 0;
  return ($8|0);
 }
 $3 = ((($m1)) + 4|0);
 $4 = +HEAPF32[$3>>2];
 $5 = ((($m2)) + 4|0);
 $6 = +HEAPF32[$5>>2];
 $7 = $4 != $6;
 if ($7) {
  $8 = 0;
  return ($8|0);
 }
 $9 = ((($m1)) + 8|0);
 $10 = +HEAPF32[$9>>2];
 $11 = ((($m2)) + 8|0);
 $12 = +HEAPF32[$11>>2];
 $13 = $10 != $12;
 if ($13) {
  $8 = 0;
  return ($8|0);
 }
 $14 = ((($m1)) + 12|0);
 $15 = +HEAPF32[$14>>2];
 $16 = ((($m2)) + 12|0);
 $17 = +HEAPF32[$16>>2];
 $18 = $15 != $17;
 if ($18) {
  $8 = 0;
  return ($8|0);
 }
 $19 = ((($m1)) + 16|0);
 $20 = +HEAPF32[$19>>2];
 $21 = ((($m2)) + 16|0);
 $22 = +HEAPF32[$21>>2];
 $23 = $20 != $22;
 if ($23) {
  $8 = 0;
  return ($8|0);
 }
 $24 = ((($m1)) + 20|0);
 $25 = +HEAPF32[$24>>2];
 $26 = ((($m2)) + 20|0);
 $27 = +HEAPF32[$26>>2];
 $28 = $25 != $27;
 if ($28) {
  $8 = 0;
  return ($8|0);
 }
 $29 = ((($m1)) + 24|0);
 $30 = +HEAPF32[$29>>2];
 $31 = ((($m2)) + 24|0);
 $32 = +HEAPF32[$31>>2];
 $33 = $30 != $32;
 if ($33) {
  $8 = 0;
  return ($8|0);
 }
 $34 = ((($m1)) + 28|0);
 $35 = +HEAPF32[$34>>2];
 $36 = ((($m2)) + 28|0);
 $37 = +HEAPF32[$36>>2];
 $38 = $35 != $37;
 if ($38) {
  $8 = 0;
  return ($8|0);
 }
 $39 = ((($m1)) + 32|0);
 $40 = +HEAPF32[$39>>2];
 $41 = ((($m2)) + 32|0);
 $42 = +HEAPF32[$41>>2];
 $43 = $40 != $42;
 if ($43) {
  $8 = 0;
  return ($8|0);
 }
 $44 = ((($m1)) + 36|0);
 $45 = +HEAPF32[$44>>2];
 $46 = ((($m2)) + 36|0);
 $47 = +HEAPF32[$46>>2];
 $48 = $45 != $47;
 if ($48) {
  $8 = 0;
  return ($8|0);
 }
 $49 = ((($m1)) + 40|0);
 $50 = +HEAPF32[$49>>2];
 $51 = ((($m2)) + 40|0);
 $52 = +HEAPF32[$51>>2];
 $53 = $50 != $52;
 if ($53) {
  $8 = 0;
  return ($8|0);
 }
 $54 = ((($m1)) + 44|0);
 $55 = +HEAPF32[$54>>2];
 $56 = ((($m2)) + 44|0);
 $57 = +HEAPF32[$56>>2];
 $58 = $55 != $57;
 if ($58) {
  $8 = 0;
  return ($8|0);
 }
 $59 = ((($m1)) + 48|0);
 $60 = +HEAPF32[$59>>2];
 $61 = ((($m2)) + 48|0);
 $62 = +HEAPF32[$61>>2];
 $63 = $60 != $62;
 if ($63) {
  $8 = 0;
  return ($8|0);
 }
 $64 = ((($m1)) + 52|0);
 $65 = +HEAPF32[$64>>2];
 $66 = ((($m2)) + 52|0);
 $67 = +HEAPF32[$66>>2];
 $68 = $65 != $67;
 if ($68) {
  $8 = 0;
  return ($8|0);
 }
 $69 = ((($m1)) + 56|0);
 $70 = +HEAPF32[$69>>2];
 $71 = ((($m2)) + 56|0);
 $72 = +HEAPF32[$71>>2];
 $73 = $70 != $72;
 if ($73) {
  $8 = 0;
  return ($8|0);
 }
 $74 = ((($m1)) + 60|0);
 $75 = +HEAPF32[$74>>2];
 $76 = ((($m2)) + 60|0);
 $77 = +HEAPF32[$76>>2];
 $78 = $75 != $77;
 if ($78) {
  $8 = 0;
  return ($8|0);
 }
 $8 = 1;
 return ($8|0);
}
function __ZN13MatrixInverse4initEv() {
 var $$0 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0;
 var $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__Znaj(64)|0);
 HEAP32[11026] = $0;
 HEAP32[11028] = $0;
 $1 = (__Znaj(128)|0);
 HEAP32[11027] = $1;
 $2 = (__Znaj(64)|0);
 HEAP32[11029] = $2;
 HEAP32[11031] = $2;
 $3 = (__Znaj(128)|0);
 HEAP32[11030] = $3;
 $4 = (__Znaj(64)|0);
 HEAP32[11032] = $4;
 $5 = (__Znaj(128)|0);
 HEAP32[11033] = $5;
 $6 = HEAP32[11032]|0;
 HEAP32[11034] = $6;
 $7 = (__Znaj(48)|0);
 HEAP32[11035] = $7;
 $8 = (__Znaj(96)|0);
 HEAP32[11036] = $8;
 $9 = (__Znaj(64)|0);
 HEAP32[11037] = $9;
 HEAPF32[$9>>2] = 1.0;
 $10 = ((($9)) + 20|0);
 HEAPF32[$10>>2] = 1.0;
 $11 = ((($9)) + 40|0);
 HEAPF32[$11>>2] = 1.0;
 $12 = HEAP32[11037]|0;
 $13 = ((($12)) + 60|0);
 HEAPF32[$13>>2] = 1.0;
 $14 = (__Znaj(128)|0);
 HEAP32[11038] = $14;
 HEAPF64[$14>>3] = 1.0;
 $15 = ((($14)) + 40|0);
 HEAPF64[$15>>3] = 1.0;
 $16 = ((($14)) + 80|0);
 HEAPF64[$16>>3] = 1.0;
 $17 = HEAP32[11038]|0;
 $18 = ((($17)) + 120|0);
 HEAPF64[$18>>3] = 1.0;
 $19 = HEAP32[11026]|0;
 __ZN13MatrixInverse10initMatrixEPf($19);
 (__ZN13MatrixInverse15matrixInverse32Ey(1,0)|0);
 $20 = tempRet0;
 $21 = HEAP32[11029]|0;
 $22 = (__ZN13MatrixInverse11checkMatrixEPf($21)|0);
 if (!($22)) {
  $$0 = 0;
  return ($$0|0);
 }
 $23 = HEAP32[11027]|0;
 __ZN13MatrixInverse12initMatrix64EPd($23);
 (__ZN13MatrixInverse15matrixInverse64Ey(1,0)|0);
 $24 = tempRet0;
 $25 = HEAP32[11030]|0;
 $26 = (__ZN13MatrixInverse13checkMatrix64EPd($25)|0);
 if (!($26)) {
  $$0 = 0;
  return ($$0|0);
 }
 $27 = HEAP32[11026]|0;
 __ZN13MatrixInverse10initMatrixEPf($27);
 (__ZN13MatrixInverse17simdMatrixInverseEy(1,0)|0);
 $28 = tempRet0;
 $29 = HEAP32[11029]|0;
 $30 = (__ZN13MatrixInverse11checkMatrixEPf($29)|0);
 $$0 = $30;
 return ($$0|0);
}
function __ZN13MatrixInverse7cleanupEv() {
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $ret$1$off0 = 0, $ret$1$off0$ = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[11026]|0;
 __ZN13MatrixInverse10initMatrixEPf($0);
 (__ZN13MatrixInverse15matrixInverse32Ey(1,0)|0);
 $1 = tempRet0;
 $2 = HEAP32[11029]|0;
 $3 = (__ZN13MatrixInverse11checkMatrixEPf($2)|0);
 $4 = HEAP32[11027]|0;
 __ZN13MatrixInverse12initMatrix64EPd($4);
 (__ZN13MatrixInverse15matrixInverse64Ey(1,0)|0);
 $5 = tempRet0;
 $6 = HEAP32[11030]|0;
 $7 = (__ZN13MatrixInverse13checkMatrix64EPd($6)|0);
 $ret$1$off0 = $3 & $7;
 $8 = HEAP32[11026]|0;
 __ZN13MatrixInverse10initMatrixEPf($8);
 (__ZN13MatrixInverse17simdMatrixInverseEy(1,0)|0);
 $9 = tempRet0;
 $10 = HEAP32[11029]|0;
 $11 = (__ZN13MatrixInverse11checkMatrixEPf($10)|0);
 $ret$1$off0$ = $ret$1$off0 & $11;
 $12 = HEAP32[11026]|0;
 $13 = ($12|0)==(0|0);
 if (!($13)) {
  __ZdaPv($12);
 }
 $14 = HEAP32[11027]|0;
 $15 = ($14|0)==(0|0);
 if (!($15)) {
  __ZdaPv($14);
 }
 $16 = HEAP32[11029]|0;
 $17 = ($16|0)==(0|0);
 if (!($17)) {
  __ZdaPv($16);
 }
 $18 = HEAP32[11030]|0;
 $19 = ($18|0)==(0|0);
 if (!($19)) {
  __ZdaPv($18);
 }
 $20 = HEAP32[11032]|0;
 $21 = ($20|0)==(0|0);
 if (!($21)) {
  __ZdaPv($20);
 }
 $22 = HEAP32[11033]|0;
 $23 = ($22|0)==(0|0);
 if (!($23)) {
  __ZdaPv($22);
 }
 $24 = HEAP32[11035]|0;
 $25 = ($24|0)==(0|0);
 if (!($25)) {
  __ZdaPv($24);
 }
 $26 = HEAP32[11036]|0;
 $27 = ($26|0)==(0|0);
 if (!($27)) {
  __ZdaPv($26);
 }
 $28 = HEAP32[11037]|0;
 $29 = ($28|0)==(0|0);
 if (!($29)) {
  __ZdaPv($28);
 }
 $30 = HEAP32[11038]|0;
 $31 = ($30|0)==(0|0);
 if ($31) {
  return ($ret$1$off0$|0);
 }
 __ZdaPv($30);
 return ($ret$1$off0$|0);
}
function __ZN13MatrixInverse17simdMatrixInverseEy($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $100 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $101 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $102 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $103 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $104 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $105 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $106 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $107 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $108 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $109 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $11 = 0, $110 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $111 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $112 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $113 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $114 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $115 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $116 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $117 = SIMD_Float32x4(0.0,0.0,0.0,0.0);
 var $118 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $119 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $12 = 0, $120 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $121 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $122 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $123 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $124 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $14 = 0, $15 = 0;
 var $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $32 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $33 = SIMD_Float32x4(0.0,0.0,0.0,0.0);
 var $34 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $35 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $36 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $37 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $38 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $39 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $4 = 0, $40 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $41 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $42 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $43 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $44 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $45 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $46 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $47 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $48 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $49 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $5 = 0, $50 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $51 = SIMD_Float32x4(0.0,0.0,0.0,0.0);
 var $52 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $53 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $54 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $55 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $56 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $57 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $58 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $59 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $6 = 0, $60 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $61 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $62 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $63 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $64 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $65 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $66 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $67 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $68 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $69 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $7 = 0;
 var $70 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $71 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $72 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $73 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $74 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $75 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $76 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $77 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $78 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $79 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $8 = 0, $80 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $81 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $82 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $83 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $84 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $85 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $86 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $87 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $88 = SIMD_Float32x4(0.0,0.0,0.0,0.0);
 var $89 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $9 = 0, $90 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $91 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $92 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $93 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $94 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $95 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $96 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $97 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $98 = SIMD_Float32x4(0.0,0.0,0.0,0.0), $99 = SIMD_Float32x4(0.0,0.0,0.0,0.0), label = 0, sp = 0, temp_Float32x4_ptr = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $25 = 4024;
  $26 = $25;
  $27 = HEAP32[$26>>2]|0;
  $28 = (($25) + 4)|0;
  $29 = $28;
  $30 = HEAP32[$29>>2]|0;
  tempRet0 = ($30);
  return ($27|0);
 }
 $5 = HEAP32[11028]|0;
 $6 = ((($5)) + 16|0);
 $7 = ((($5)) + 32|0);
 $8 = ((($5)) + 48|0);
 $9 = HEAP32[11031]|0;
 $10 = ((($9)) + 16|0);
 $11 = ((($9)) + 32|0);
 $12 = ((($9)) + 48|0);
 $13 = 4024;
 $14 = $13;
 $15 = HEAP32[$14>>2]|0;
 $16 = (($13) + 4)|0;
 $17 = $16;
 $18 = HEAP32[$17>>2]|0;
 $125 = 0;$126 = 0;
 while(1) {
  $31 = SIMD_Float32x4_load(HEAPU8, $5);
  $32 = SIMD_Float32x4_load(HEAPU8, $6);
  $33 = SIMD_Float32x4_load(HEAPU8, $7);
  $34 = SIMD_Float32x4_load(HEAPU8, $8);
  $35 = SIMD_Float32x4_shuffle($31, $32, 0, 1, 4, 5);
  $36 = SIMD_Float32x4_shuffle($33, $34, 0, 1, 4, 5);
  $37 = SIMD_Float32x4_shuffle($35, $36, 0, 2, 4, 6);
  $38 = SIMD_Float32x4_shuffle($36, $35, 1, 3, 5, 7);
  $39 = SIMD_Float32x4_shuffle($31, $32, 2, 3, 6, 7);
  $40 = SIMD_Float32x4_shuffle($33, $34, 2, 3, 6, 7);
  $41 = SIMD_Float32x4_shuffle($39, $40, 0, 2, 4, 6);
  $42 = SIMD_Float32x4_shuffle($40, $39, 1, 3, 5, 7);
  $43 = SIMD_Float32x4_mul($41,$42);
  $44 = SIMD_Float32x4_swizzle($43, 1, 0, 3, 2);
  $45 = SIMD_Float32x4_mul($38,$44);
  $46 = SIMD_Float32x4_mul($37,$44);
  $47 = SIMD_Float32x4_swizzle($43, 3, 2, 1, 0);
  $48 = SIMD_Float32x4_mul($38,$47);
  $49 = SIMD_Float32x4_sub($48,$45);
  $50 = SIMD_Float32x4_mul($37,$47);
  $51 = SIMD_Float32x4_sub($50,$46);
  $52 = SIMD_Float32x4_swizzle($51, 2, 3, 0, 1);
  $53 = SIMD_Float32x4_mul($38,$41);
  $54 = SIMD_Float32x4_swizzle($53, 1, 0, 3, 2);
  $55 = SIMD_Float32x4_mul($42,$54);
  $56 = SIMD_Float32x4_add($55,$49);
  $57 = SIMD_Float32x4_mul($37,$54);
  $58 = SIMD_Float32x4_swizzle($53, 3, 2, 1, 0);
  $59 = SIMD_Float32x4_mul($42,$58);
  $60 = SIMD_Float32x4_sub($56,$59);
  $61 = SIMD_Float32x4_mul($37,$58);
  $62 = SIMD_Float32x4_sub($61,$57);
  $63 = SIMD_Float32x4_swizzle($62, 2, 3, 0, 1);
  $64 = SIMD_Float32x4_shuffle($36, $35, 5, 7, 1, 3);
  $65 = SIMD_Float32x4_mul($64,$42);
  $66 = SIMD_Float32x4_swizzle($65, 1, 0, 3, 2);
  $67 = SIMD_Float32x4_shuffle($39, $40, 4, 6, 0, 2);
  $68 = SIMD_Float32x4_mul($67,$66);
  $69 = SIMD_Float32x4_add($68,$60);
  $70 = SIMD_Float32x4_mul($37,$66);
  $71 = SIMD_Float32x4_swizzle($65, 3, 2, 1, 0);
  $72 = SIMD_Float32x4_mul($67,$71);
  $73 = SIMD_Float32x4_sub($69,$72);
  $74 = SIMD_Float32x4_mul($37,$71);
  $75 = SIMD_Float32x4_sub($74,$70);
  $76 = SIMD_Float32x4_swizzle($75, 2, 3, 0, 1);
  $77 = SIMD_Float32x4_mul($37,$38);
  $78 = SIMD_Float32x4_swizzle($77, 1, 0, 3, 2);
  $79 = SIMD_Float32x4_mul($42,$78);
  $80 = SIMD_Float32x4_add($79,$76);
  $81 = SIMD_Float32x4_mul($67,$78);
  $82 = SIMD_Float32x4_sub($81,$63);
  $83 = SIMD_Float32x4_swizzle($77, 3, 2, 1, 0);
  $84 = SIMD_Float32x4_mul($42,$83);
  $85 = SIMD_Float32x4_sub($84,$80);
  $86 = SIMD_Float32x4_mul($67,$83);
  $87 = SIMD_Float32x4_sub($82,$86);
  $88 = SIMD_Float32x4_mul($37,$42);
  $89 = SIMD_Float32x4_swizzle($88, 1, 0, 3, 2);
  $90 = SIMD_Float32x4_mul($67,$89);
  $91 = SIMD_Float32x4_sub($52,$90);
  $92 = SIMD_Float32x4_mul($38,$89);
  $93 = SIMD_Float32x4_add($92,$85);
  $94 = SIMD_Float32x4_swizzle($88, 3, 2, 1, 0);
  $95 = SIMD_Float32x4_mul($67,$94);
  $96 = SIMD_Float32x4_add($95,$91);
  $97 = SIMD_Float32x4_mul($38,$94);
  $98 = SIMD_Float32x4_sub($93,$97);
  $99 = SIMD_Float32x4_mul($37,$67);
  $100 = SIMD_Float32x4_swizzle($99, 1, 0, 3, 2);
  $101 = SIMD_Float32x4_mul($42,$100);
  $102 = SIMD_Float32x4_add($101,$96);
  $103 = SIMD_Float32x4_mul($38,$100);
  $104 = SIMD_Float32x4_sub($87,$103);
  $105 = SIMD_Float32x4_swizzle($99, 3, 2, 1, 0);
  $106 = SIMD_Float32x4_mul($42,$105);
  $107 = SIMD_Float32x4_sub($102,$106);
  $108 = SIMD_Float32x4_mul($38,$105);
  $109 = SIMD_Float32x4_add($108,$104);
  $110 = SIMD_Float32x4_mul($37,$73);
  $111 = SIMD_Float32x4_swizzle($110, 2, 3, 0, 1);
  $112 = SIMD_Float32x4_add($110,$111);
  $113 = SIMD_Float32x4_swizzle($112, 1, 0, 3, 2);
  $114 = SIMD_Float32x4_add($112,$113);
  $115 = SIMD_Float32x4_div(SIMD_Float32x4_splat(Math_fround(1.0)),$114);
  $116 = SIMD_Float32x4_add($115,$115);
  $117 = SIMD_Float32x4_mul($115,$115);
  $118 = SIMD_Float32x4_mul($114,$117);
  $119 = SIMD_Float32x4_sub($116,$118);
  $120 = SIMD_Float32x4_swizzle($119, 0, 0, 0, 0);
  $121 = SIMD_Float32x4_mul($73,$120);
  $122 = SIMD_Float32x4_mul($107,$120);
  $123 = SIMD_Float32x4_mul($98,$120);
  $124 = SIMD_Float32x4_mul($109,$120);
  temp_Float32x4_ptr = $9;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $121);
  temp_Float32x4_ptr = $10;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $122);
  temp_Float32x4_ptr = $11;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $123);
  temp_Float32x4_ptr = $12;SIMD_Float32x4_store(HEAPU8, temp_Float32x4_ptr, $124);
  $127 = (_i64Add(($125|0),($126|0),1,0)|0);
  $128 = tempRet0;
  $129 = ($128>>>0)<($1>>>0);
  $130 = ($127>>>0)<($0>>>0);
  $131 = ($128|0)==($1|0);
  $132 = $131 & $130;
  $133 = $129 | $132;
  if ($133) {
   $125 = $127;$126 = $128;
  } else {
   break;
  }
 }
 $19 = (_i64Add(($15|0),($18|0),($0|0),($1|0))|0);
 $20 = tempRet0;
 $21 = 4024;
 $22 = $21;
 HEAP32[$22>>2] = $19;
 $23 = (($21) + 4)|0;
 $24 = $23;
 HEAP32[$24>>2] = $20;
 $25 = 4024;
 $26 = $25;
 $27 = HEAP32[$26>>2]|0;
 $28 = (($25) + 4)|0;
 $29 = $28;
 $30 = HEAP32[$29>>2]|0;
 tempRet0 = ($30);
 return ($27|0);
}
function __ZN13MatrixInverse15matrixInverse32Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0;
 var $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0;
 var $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0;
 var $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0, $170 = 0, $171 = 0;
 var $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0;
 var $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0;
 var $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0;
 var $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0;
 var $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0;
 var $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0.0, $269 = 0, $27 = 0, $270 = 0.0, $271 = 0.0, $272 = 0, $273 = 0, $274 = 0.0, $275 = 0, $276 = 0.0, $277 = 0.0, $278 = 0, $279 = 0, $28 = 0;
 var $280 = 0.0, $281 = 0, $282 = 0.0, $283 = 0.0, $284 = 0, $285 = 0, $286 = 0.0, $287 = 0, $288 = 0.0, $289 = 0.0, $29 = 0, $290 = 0, $291 = 0, $292 = 0.0, $293 = 0, $294 = 0.0, $295 = 0.0, $296 = 0, $297 = 0, $298 = 0.0;
 var $299 = 0, $3 = 0, $30 = 0, $300 = 0.0, $301 = 0.0, $302 = 0, $303 = 0, $304 = 0.0, $305 = 0, $306 = 0.0, $307 = 0.0, $308 = 0, $309 = 0, $31 = 0, $310 = 0.0, $311 = 0, $312 = 0.0, $313 = 0.0, $314 = 0, $315 = 0;
 var $316 = 0.0, $317 = 0, $318 = 0.0, $319 = 0.0, $32 = 0, $320 = 0, $321 = 0, $322 = 0.0, $323 = 0, $324 = 0.0, $325 = 0.0, $326 = 0, $327 = 0, $328 = 0.0, $329 = 0, $33 = 0, $330 = 0.0, $331 = 0.0, $332 = 0, $333 = 0;
 var $334 = 0.0, $335 = 0, $336 = 0.0, $337 = 0.0, $338 = 0.0, $339 = 0, $34 = 0, $340 = 0, $341 = 0.0, $342 = 0.0, $343 = 0.0, $344 = 0, $345 = 0.0, $346 = 0.0, $347 = 0.0, $348 = 0.0, $349 = 0, $35 = 0, $350 = 0.0, $351 = 0.0;
 var $352 = 0.0, $353 = 0.0, $354 = 0, $355 = 0, $356 = 0.0, $357 = 0.0, $358 = 0.0, $359 = 0, $36 = 0, $360 = 0.0, $361 = 0.0, $362 = 0.0, $363 = 0.0, $364 = 0, $365 = 0.0, $366 = 0.0, $367 = 0.0, $368 = 0.0, $369 = 0.0, $37 = 0;
 var $370 = 0.0, $371 = 0, $372 = 0, $373 = 0.0, $374 = 0.0, $375 = 0.0, $376 = 0, $377 = 0.0, $378 = 0.0, $379 = 0.0, $38 = 0, $380 = 0.0, $381 = 0, $382 = 0.0, $383 = 0.0, $384 = 0.0, $385 = 0.0, $386 = 0, $387 = 0, $388 = 0.0;
 var $389 = 0.0, $39 = 0, $390 = 0.0, $391 = 0, $392 = 0.0, $393 = 0.0, $394 = 0.0, $395 = 0.0, $396 = 0, $397 = 0.0, $398 = 0.0, $399 = 0.0, $4 = 0, $40 = 0, $400 = 0.0, $401 = 0.0, $402 = 0.0, $403 = 0, $404 = 0, $405 = 0.0;
 var $406 = 0.0, $407 = 0.0, $408 = 0, $409 = 0.0, $41 = 0, $410 = 0.0, $411 = 0.0, $412 = 0.0, $413 = 0, $414 = 0.0, $415 = 0.0, $416 = 0.0, $417 = 0.0, $418 = 0, $419 = 0, $42 = 0, $420 = 0.0, $421 = 0.0, $422 = 0.0, $423 = 0;
 var $424 = 0.0, $425 = 0.0, $426 = 0.0, $427 = 0.0, $428 = 0, $429 = 0.0, $43 = 0, $430 = 0.0, $431 = 0.0, $432 = 0.0, $433 = 0.0, $434 = 0.0, $435 = 0, $436 = 0, $437 = 0.0, $438 = 0.0, $439 = 0.0, $44 = 0, $440 = 0, $441 = 0.0;
 var $442 = 0.0, $443 = 0.0, $444 = 0.0, $445 = 0, $446 = 0.0, $447 = 0.0, $448 = 0.0, $449 = 0.0, $45 = 0, $450 = 0, $451 = 0, $452 = 0.0, $453 = 0.0, $454 = 0.0, $455 = 0, $456 = 0.0, $457 = 0.0, $458 = 0.0, $459 = 0.0, $46 = 0;
 var $460 = 0, $461 = 0.0, $462 = 0.0, $463 = 0.0, $464 = 0.0, $465 = 0.0, $466 = 0.0, $467 = 0, $468 = 0, $469 = 0.0, $47 = 0, $470 = 0.0, $471 = 0.0, $472 = 0, $473 = 0.0, $474 = 0.0, $475 = 0.0, $476 = 0.0, $477 = 0, $478 = 0.0;
 var $479 = 0.0, $48 = 0, $480 = 0.0, $481 = 0.0, $482 = 0, $483 = 0, $484 = 0.0, $485 = 0.0, $486 = 0.0, $487 = 0, $488 = 0.0, $489 = 0.0, $49 = 0, $490 = 0.0, $491 = 0.0, $492 = 0, $493 = 0.0, $494 = 0.0, $495 = 0.0, $496 = 0.0;
 var $497 = 0.0, $498 = 0.0, $499 = 0, $5 = 0, $50 = 0, $500 = 0.0, $501 = 0.0, $502 = 0.0, $503 = 0, $504 = 0.0, $505 = 0.0, $506 = 0.0, $507 = 0.0, $508 = 0, $509 = 0.0, $51 = 0, $510 = 0.0, $511 = 0.0, $512 = 0.0, $513 = 0;
 var $514 = 0.0, $515 = 0.0, $516 = 0.0, $517 = 0, $518 = 0.0, $519 = 0.0, $52 = 0, $520 = 0.0, $521 = 0.0, $522 = 0, $523 = 0.0, $524 = 0.0, $525 = 0.0, $526 = 0.0, $527 = 0.0, $528 = 0.0, $529 = 0, $53 = 0, $530 = 0.0, $531 = 0.0;
 var $532 = 0.0, $533 = 0, $534 = 0.0, $535 = 0.0, $536 = 0.0, $537 = 0.0, $538 = 0, $539 = 0.0, $54 = 0, $540 = 0.0, $541 = 0.0, $542 = 0.0, $543 = 0, $544 = 0.0, $545 = 0.0, $546 = 0.0, $547 = 0, $548 = 0.0, $549 = 0.0, $55 = 0;
 var $550 = 0.0, $551 = 0.0, $552 = 0, $553 = 0.0, $554 = 0.0, $555 = 0.0, $556 = 0.0, $557 = 0.0, $558 = 0.0, $559 = 0, $56 = 0, $560 = 0.0, $561 = 0.0, $562 = 0.0, $563 = 0, $564 = 0.0, $565 = 0.0, $566 = 0.0, $567 = 0.0, $568 = 0;
 var $569 = 0.0, $57 = 0, $570 = 0.0, $571 = 0.0, $572 = 0.0, $573 = 0, $574 = 0.0, $575 = 0.0, $576 = 0.0, $577 = 0, $578 = 0.0, $579 = 0.0, $58 = 0, $580 = 0.0, $581 = 0.0, $582 = 0, $583 = 0.0, $584 = 0.0, $585 = 0.0, $586 = 0.0;
 var $587 = 0.0, $588 = 0, $589 = 0, $59 = 0, $590 = 0.0, $591 = 0, $592 = 0.0, $593 = 0.0, $594 = 0, $595 = 0, $596 = 0.0, $597 = 0, $598 = 0.0, $599 = 0.0, $6 = 0, $60 = 0, $600 = 0, $601 = 0, $602 = 0.0, $603 = 0;
 var $604 = 0.0, $605 = 0.0, $606 = 0, $607 = 0, $608 = 0.0, $609 = 0, $61 = 0, $610 = 0.0, $611 = 0.0, $612 = 0, $613 = 0, $614 = 0.0, $615 = 0, $616 = 0.0, $617 = 0.0, $618 = 0, $619 = 0, $62 = 0, $620 = 0.0, $621 = 0;
 var $622 = 0.0, $623 = 0.0, $624 = 0, $625 = 0.0, $626 = 0, $627 = 0.0, $628 = 0.0, $629 = 0, $63 = 0, $630 = 0, $631 = 0.0, $632 = 0, $633 = 0.0, $634 = 0.0, $635 = 0, $636 = 0.0, $637 = 0, $638 = 0.0, $639 = 0.0, $64 = 0;
 var $640 = 0, $641 = 0, $642 = 0.0, $643 = 0, $644 = 0.0, $645 = 0.0, $646 = 0, $647 = 0.0, $648 = 0, $649 = 0.0, $65 = 0, $650 = 0.0, $651 = 0, $652 = 0, $653 = 0.0, $654 = 0, $655 = 0.0, $656 = 0.0, $657 = 0.0, $658 = 0;
 var $659 = 0, $66 = 0, $660 = 0.0, $661 = 0.0, $662 = 0.0, $663 = 0, $664 = 0.0, $665 = 0.0, $666 = 0.0, $667 = 0.0, $668 = 0, $669 = 0.0, $67 = 0, $670 = 0.0, $671 = 0.0, $672 = 0.0, $673 = 0, $674 = 0, $675 = 0.0, $676 = 0.0;
 var $677 = 0.0, $678 = 0, $679 = 0.0, $68 = 0, $680 = 0.0, $681 = 0.0, $682 = 0.0, $683 = 0, $684 = 0.0, $685 = 0.0, $686 = 0.0, $687 = 0.0, $688 = 0.0, $689 = 0.0, $69 = 0, $690 = 0, $691 = 0, $692 = 0.0, $693 = 0.0, $694 = 0.0;
 var $695 = 0, $696 = 0.0, $697 = 0.0, $698 = 0.0, $699 = 0.0, $7 = 0, $70 = 0, $700 = 0, $701 = 0.0, $702 = 0.0, $703 = 0.0, $704 = 0.0, $705 = 0, $706 = 0, $707 = 0.0, $708 = 0.0, $709 = 0.0, $71 = 0, $710 = 0, $711 = 0.0;
 var $712 = 0.0, $713 = 0.0, $714 = 0.0, $715 = 0, $716 = 0.0, $717 = 0.0, $718 = 0.0, $719 = 0.0, $72 = 0, $720 = 0.0, $721 = 0.0, $722 = 0, $723 = 0, $724 = 0.0, $725 = 0.0, $726 = 0.0, $727 = 0, $728 = 0.0, $729 = 0.0, $73 = 0;
 var $730 = 0.0, $731 = 0.0, $732 = 0, $733 = 0.0, $734 = 0.0, $735 = 0.0, $736 = 0.0, $737 = 0, $738 = 0, $739 = 0.0, $74 = 0, $740 = 0.0, $741 = 0.0, $742 = 0, $743 = 0.0, $744 = 0.0, $745 = 0.0, $746 = 0.0, $747 = 0, $748 = 0.0;
 var $749 = 0.0, $75 = 0, $750 = 0.0, $751 = 0.0, $752 = 0.0, $753 = 0.0, $754 = 0, $755 = 0, $756 = 0.0, $757 = 0.0, $758 = 0.0, $759 = 0, $76 = 0, $760 = 0.0, $761 = 0.0, $762 = 0.0, $763 = 0.0, $764 = 0, $765 = 0.0, $766 = 0.0;
 var $767 = 0.0, $768 = 0.0, $769 = 0, $77 = 0, $770 = 0, $771 = 0.0, $772 = 0.0, $773 = 0.0, $774 = 0, $775 = 0.0, $776 = 0.0, $777 = 0.0, $778 = 0.0, $779 = 0, $78 = 0, $780 = 0.0, $781 = 0.0, $782 = 0.0, $783 = 0.0, $784 = 0.0;
 var $785 = 0.0, $786 = 0, $787 = 0, $788 = 0.0, $789 = 0.0, $79 = 0, $790 = 0.0, $791 = 0, $792 = 0.0, $793 = 0.0, $794 = 0.0, $795 = 0.0, $796 = 0, $797 = 0.0, $798 = 0.0, $799 = 0.0, $8 = 0, $80 = 0, $800 = 0.0, $801 = 0;
 var $802 = 0, $803 = 0.0, $804 = 0.0, $805 = 0.0, $806 = 0, $807 = 0.0, $808 = 0.0, $809 = 0.0, $81 = 0, $810 = 0.0, $811 = 0, $812 = 0.0, $813 = 0.0, $814 = 0.0, $815 = 0.0, $816 = 0.0, $817 = 0.0, $818 = 0, $819 = 0, $82 = 0;
 var $820 = 0.0, $821 = 0.0, $822 = 0.0, $823 = 0, $824 = 0.0, $825 = 0.0, $826 = 0.0, $827 = 0.0, $828 = 0, $829 = 0.0, $83 = 0, $830 = 0.0, $831 = 0.0, $832 = 0.0, $833 = 0, $834 = 0, $835 = 0.0, $836 = 0.0, $837 = 0.0, $838 = 0;
 var $839 = 0.0, $84 = 0, $840 = 0.0, $841 = 0.0, $842 = 0.0, $843 = 0, $844 = 0.0, $845 = 0.0, $846 = 0.0, $847 = 0.0, $848 = 0.0, $849 = 0.0, $85 = 0, $850 = 0, $851 = 0, $852 = 0.0, $853 = 0.0, $854 = 0.0, $855 = 0, $856 = 0.0;
 var $857 = 0.0, $858 = 0.0, $859 = 0.0, $86 = 0, $860 = 0, $861 = 0.0, $862 = 0.0, $863 = 0.0, $864 = 0.0, $865 = 0, $866 = 0, $867 = 0.0, $868 = 0.0, $869 = 0.0, $87 = 0, $870 = 0, $871 = 0.0, $872 = 0.0, $873 = 0.0, $874 = 0.0;
 var $875 = 0, $876 = 0.0, $877 = 0.0, $878 = 0.0, $879 = 0.0, $88 = 0, $880 = 0.0, $881 = 0.0, $882 = 0, $883 = 0, $884 = 0.0, $885 = 0.0, $886 = 0.0, $887 = 0, $888 = 0.0, $889 = 0.0, $89 = 0, $890 = 0.0, $891 = 0.0, $892 = 0;
 var $893 = 0.0, $894 = 0.0, $895 = 0.0, $896 = 0.0, $897 = 0, $898 = 0, $899 = 0.0, $9 = 0, $90 = 0, $900 = 0.0, $901 = 0.0, $902 = 0, $903 = 0.0, $904 = 0.0, $905 = 0.0, $906 = 0.0, $907 = 0, $908 = 0.0, $909 = 0.0, $91 = 0;
 var $910 = 0.0, $911 = 0.0, $912 = 0.0, $913 = 0, $914 = 0.0, $915 = 0.0, $916 = 0.0, $917 = 0, $918 = 0.0, $919 = 0.0, $92 = 0, $920 = 0.0, $921 = 0.0, $922 = 0, $923 = 0.0, $924 = 0.0, $925 = 0.0, $926 = 0.0, $927 = 0, $928 = 0.0;
 var $929 = 0.0, $93 = 0, $930 = 0.0, $931 = 0.0, $932 = 0.0, $933 = 0.0, $934 = 0.0, $935 = 0.0, $936 = 0.0, $937 = 0.0, $938 = 0.0, $939 = 0.0, $94 = 0, $940 = 0.0, $941 = 0.0, $942 = 0.0, $943 = 0.0, $944 = 0.0, $945 = 0.0, $946 = 0.0;
 var $947 = 0.0, $948 = 0.0, $949 = 0.0, $95 = 0, $950 = 0.0, $951 = 0.0, $952 = 0.0, $953 = 0.0, $954 = 0.0, $955 = 0.0, $956 = 0.0, $957 = 0.0, $958 = 0.0, $959 = 0.0, $96 = 0, $960 = 0.0, $961 = 0.0, $962 = 0.0, $963 = 0.0, $964 = 0.0;
 var $965 = 0, $966 = 0, $967 = 0, $968 = 0, $969 = 0, $97 = 0, $970 = 0, $971 = 0, $972 = 0, $973 = 0, $98 = 0, $99 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $212 = 4024;
  $213 = $212;
  $214 = HEAP32[$213>>2]|0;
  $215 = (($212) + 4)|0;
  $216 = $215;
  $217 = HEAP32[$216>>2]|0;
  tempRet0 = ($217);
  return ($214|0);
 }
 $5 = HEAP32[11035]|0;
 $6 = ((($5)) + 4|0);
 $7 = ((($5)) + 8|0);
 $8 = ((($5)) + 12|0);
 $9 = ((($5)) + 16|0);
 $10 = ((($5)) + 20|0);
 $11 = ((($5)) + 24|0);
 $12 = HEAP32[11035]|0;
 $13 = ((($12)) + 28|0);
 $14 = ((($12)) + 32|0);
 $15 = ((($12)) + 36|0);
 $16 = ((($12)) + 40|0);
 $17 = ((($12)) + 44|0);
 $18 = ((($12)) + 12|0);
 $19 = ((($12)) + 16|0);
 $20 = HEAP32[11029]|0;
 $21 = HEAP32[11035]|0;
 $22 = ((($21)) + 4|0);
 $23 = ((($21)) + 8|0);
 $24 = ((($21)) + 20|0);
 $25 = ((($21)) + 4|0);
 $26 = ((($21)) + 24|0);
 $27 = ((($21)) + 36|0);
 $28 = HEAP32[11029]|0;
 $29 = ((($28)) + 4|0);
 $30 = HEAP32[11035]|0;
 $31 = ((($30)) + 28|0);
 $32 = ((($30)) + 32|0);
 $33 = ((($28)) + 4|0);
 $34 = ((($30)) + 8|0);
 $35 = ((($30)) + 28|0);
 $36 = ((($30)) + 40|0);
 $37 = HEAP32[11029]|0;
 $38 = ((($37)) + 8|0);
 $39 = HEAP32[11035]|0;
 $40 = ((($39)) + 12|0);
 $41 = ((($39)) + 24|0);
 $42 = ((($39)) + 44|0);
 $43 = ((($37)) + 8|0);
 $44 = ((($39)) + 20|0);
 $45 = ((($39)) + 32|0);
 $46 = ((($39)) + 44|0);
 $47 = HEAP32[11029]|0;
 $48 = ((($47)) + 12|0);
 $49 = HEAP32[11035]|0;
 $50 = ((($49)) + 16|0);
 $51 = ((($49)) + 36|0);
 $52 = ((($49)) + 40|0);
 $53 = ((($47)) + 12|0);
 $54 = ((($49)) + 4|0);
 $55 = ((($49)) + 8|0);
 $56 = ((($49)) + 20|0);
 $57 = HEAP32[11029]|0;
 $58 = ((($57)) + 16|0);
 $59 = HEAP32[11035]|0;
 $60 = ((($59)) + 12|0);
 $61 = ((($59)) + 16|0);
 $62 = ((($57)) + 16|0);
 $63 = ((($59)) + 28|0);
 $64 = ((($59)) + 32|0);
 $65 = HEAP32[11029]|0;
 $66 = ((($65)) + 20|0);
 $67 = HEAP32[11035]|0;
 $68 = ((($67)) + 4|0);
 $69 = ((($67)) + 24|0);
 $70 = ((($67)) + 36|0);
 $71 = ((($65)) + 20|0);
 $72 = ((($67)) + 12|0);
 $73 = ((($67)) + 24|0);
 $74 = ((($67)) + 44|0);
 $75 = HEAP32[11029]|0;
 $76 = ((($75)) + 24|0);
 $77 = HEAP32[11035]|0;
 $78 = ((($77)) + 8|0);
 $79 = ((($77)) + 28|0);
 $80 = ((($77)) + 40|0);
 $81 = ((($75)) + 24|0);
 $82 = ((($77)) + 16|0);
 $83 = ((($77)) + 36|0);
 $84 = ((($77)) + 40|0);
 $85 = HEAP32[11029]|0;
 $86 = ((($85)) + 28|0);
 $87 = HEAP32[11035]|0;
 $88 = ((($87)) + 20|0);
 $89 = ((($87)) + 32|0);
 $90 = ((($87)) + 44|0);
 $91 = ((($85)) + 28|0);
 $92 = ((($87)) + 4|0);
 $93 = ((($87)) + 8|0);
 $94 = HEAP32[11035]|0;
 $95 = ((($94)) + 12|0);
 $96 = ((($94)) + 16|0);
 $97 = ((($94)) + 20|0);
 $98 = ((($94)) + 24|0);
 $99 = ((($94)) + 28|0);
 $100 = ((($94)) + 32|0);
 $101 = HEAP32[11035]|0;
 $102 = ((($101)) + 36|0);
 $103 = ((($101)) + 40|0);
 $104 = ((($101)) + 44|0);
 $105 = ((($101)) + 12|0);
 $106 = ((($101)) + 16|0);
 $107 = HEAP32[11029]|0;
 $108 = ((($107)) + 32|0);
 $109 = HEAP32[11035]|0;
 $110 = ((($109)) + 4|0);
 $111 = ((($109)) + 8|0);
 $112 = ((($109)) + 20|0);
 $113 = ((($107)) + 32|0);
 $114 = ((($109)) + 4|0);
 $115 = ((($109)) + 24|0);
 $116 = ((($109)) + 36|0);
 $117 = HEAP32[11029]|0;
 $118 = ((($117)) + 36|0);
 $119 = HEAP32[11035]|0;
 $120 = ((($119)) + 28|0);
 $121 = ((($119)) + 32|0);
 $122 = ((($117)) + 36|0);
 $123 = ((($119)) + 8|0);
 $124 = ((($119)) + 28|0);
 $125 = ((($119)) + 40|0);
 $126 = HEAP32[11029]|0;
 $127 = ((($126)) + 40|0);
 $128 = HEAP32[11035]|0;
 $129 = ((($128)) + 12|0);
 $130 = ((($128)) + 24|0);
 $131 = ((($128)) + 44|0);
 $132 = ((($126)) + 40|0);
 $133 = ((($128)) + 20|0);
 $134 = ((($128)) + 32|0);
 $135 = ((($128)) + 44|0);
 $136 = HEAP32[11029]|0;
 $137 = ((($136)) + 44|0);
 $138 = HEAP32[11035]|0;
 $139 = ((($138)) + 16|0);
 $140 = ((($138)) + 36|0);
 $141 = ((($138)) + 40|0);
 $142 = ((($136)) + 44|0);
 $143 = ((($138)) + 8|0);
 $144 = ((($138)) + 20|0);
 $145 = ((($138)) + 4|0);
 $146 = HEAP32[11029]|0;
 $147 = ((($146)) + 48|0);
 $148 = HEAP32[11035]|0;
 $149 = ((($148)) + 16|0);
 $150 = ((($148)) + 12|0);
 $151 = ((($146)) + 48|0);
 $152 = ((($148)) + 32|0);
 $153 = ((($148)) + 28|0);
 $154 = HEAP32[11029]|0;
 $155 = ((($154)) + 52|0);
 $156 = HEAP32[11035]|0;
 $157 = ((($156)) + 24|0);
 $158 = ((($156)) + 36|0);
 $159 = ((($156)) + 4|0);
 $160 = ((($154)) + 52|0);
 $161 = ((($156)) + 24|0);
 $162 = ((($156)) + 44|0);
 $163 = ((($156)) + 12|0);
 $164 = HEAP32[11029]|0;
 $165 = ((($164)) + 56|0);
 $166 = HEAP32[11035]|0;
 $167 = ((($166)) + 40|0);
 $168 = ((($166)) + 8|0);
 $169 = ((($166)) + 28|0);
 $170 = ((($164)) + 56|0);
 $171 = ((($166)) + 40|0);
 $172 = ((($166)) + 16|0);
 $173 = ((($166)) + 36|0);
 $174 = HEAP32[11029]|0;
 $175 = ((($174)) + 60|0);
 $176 = HEAP32[11035]|0;
 $177 = ((($176)) + 32|0);
 $178 = ((($176)) + 44|0);
 $179 = ((($176)) + 20|0);
 $180 = ((($174)) + 60|0);
 $181 = HEAP32[11029]|0;
 $182 = ((($181)) + 4|0);
 $183 = ((($181)) + 8|0);
 $184 = ((($181)) + 12|0);
 $185 = 4024;
 $186 = $185;
 $187 = HEAP32[$186>>2]|0;
 $188 = (($185) + 4)|0;
 $189 = $188;
 $190 = HEAP32[$189>>2]|0;
 $191 = ((($181)) + 4|0);
 $192 = ((($181)) + 8|0);
 $193 = ((($181)) + 12|0);
 $194 = ((($181)) + 16|0);
 $195 = ((($181)) + 20|0);
 $196 = ((($181)) + 24|0);
 $197 = ((($181)) + 28|0);
 $198 = ((($181)) + 32|0);
 $199 = ((($181)) + 36|0);
 $200 = ((($181)) + 40|0);
 $201 = ((($181)) + 44|0);
 $202 = ((($181)) + 48|0);
 $203 = ((($181)) + 52|0);
 $204 = ((($181)) + 56|0);
 $205 = ((($181)) + 60|0);
 $965 = 0;$966 = 0;
 while(1) {
  $218 = HEAP32[11026]|0;
  $219 = HEAP32[11032]|0;
  $220 = HEAP32[$218>>2]|0;
  HEAP32[$219>>2] = $220;
  $221 = ((($218)) + 4|0);
  $222 = HEAP32[$221>>2]|0;
  $223 = ((($219)) + 16|0);
  HEAP32[$223>>2] = $222;
  $224 = ((($218)) + 8|0);
  $225 = HEAP32[$224>>2]|0;
  $226 = ((($219)) + 32|0);
  HEAP32[$226>>2] = $225;
  $227 = ((($218)) + 12|0);
  $228 = HEAP32[$227>>2]|0;
  $229 = ((($219)) + 48|0);
  HEAP32[$229>>2] = $228;
  $230 = ((($218)) + 16|0);
  $231 = HEAP32[$230>>2]|0;
  $232 = ((($219)) + 4|0);
  HEAP32[$232>>2] = $231;
  $233 = ((($218)) + 20|0);
  $234 = HEAP32[$233>>2]|0;
  $235 = ((($219)) + 20|0);
  HEAP32[$235>>2] = $234;
  $236 = ((($218)) + 24|0);
  $237 = HEAP32[$236>>2]|0;
  $238 = ((($219)) + 36|0);
  HEAP32[$238>>2] = $237;
  $239 = ((($218)) + 28|0);
  $240 = HEAP32[$239>>2]|0;
  $241 = ((($219)) + 52|0);
  HEAP32[$241>>2] = $240;
  $242 = ((($218)) + 32|0);
  $243 = HEAP32[$242>>2]|0;
  $244 = ((($219)) + 8|0);
  HEAP32[$244>>2] = $243;
  $245 = ((($218)) + 36|0);
  $246 = HEAP32[$245>>2]|0;
  $247 = ((($219)) + 24|0);
  HEAP32[$247>>2] = $246;
  $248 = ((($218)) + 40|0);
  $249 = HEAP32[$248>>2]|0;
  $250 = ((($219)) + 40|0);
  HEAP32[$250>>2] = $249;
  $251 = ((($218)) + 44|0);
  $252 = HEAP32[$251>>2]|0;
  $253 = ((($219)) + 56|0);
  HEAP32[$253>>2] = $252;
  $254 = ((($218)) + 48|0);
  $255 = HEAP32[$254>>2]|0;
  $256 = ((($219)) + 12|0);
  HEAP32[$256>>2] = $255;
  $257 = ((($218)) + 52|0);
  $258 = HEAP32[$257>>2]|0;
  $259 = ((($219)) + 28|0);
  HEAP32[$259>>2] = $258;
  $260 = ((($218)) + 56|0);
  $261 = HEAP32[$260>>2]|0;
  $262 = ((($219)) + 44|0);
  HEAP32[$262>>2] = $261;
  $263 = ((($218)) + 60|0);
  $264 = HEAP32[$263>>2]|0;
  $265 = ((($219)) + 60|0);
  HEAP32[$265>>2] = $264;
  $266 = HEAP32[11032]|0;
  $267 = ((($266)) + 40|0);
  $268 = +HEAPF32[$267>>2];
  $269 = ((($266)) + 60|0);
  $270 = +HEAPF32[$269>>2];
  $271 = $268 * $270;
  HEAPF32[$5>>2] = $271;
  $272 = HEAP32[11032]|0;
  $273 = ((($272)) + 44|0);
  $274 = +HEAPF32[$273>>2];
  $275 = ((($272)) + 56|0);
  $276 = +HEAPF32[$275>>2];
  $277 = $274 * $276;
  HEAPF32[$6>>2] = $277;
  $278 = HEAP32[11032]|0;
  $279 = ((($278)) + 36|0);
  $280 = +HEAPF32[$279>>2];
  $281 = ((($278)) + 60|0);
  $282 = +HEAPF32[$281>>2];
  $283 = $280 * $282;
  HEAPF32[$7>>2] = $283;
  $284 = HEAP32[11032]|0;
  $285 = ((($284)) + 44|0);
  $286 = +HEAPF32[$285>>2];
  $287 = ((($284)) + 52|0);
  $288 = +HEAPF32[$287>>2];
  $289 = $286 * $288;
  HEAPF32[$8>>2] = $289;
  $290 = HEAP32[11032]|0;
  $291 = ((($290)) + 36|0);
  $292 = +HEAPF32[$291>>2];
  $293 = ((($290)) + 56|0);
  $294 = +HEAPF32[$293>>2];
  $295 = $292 * $294;
  HEAPF32[$9>>2] = $295;
  $296 = HEAP32[11032]|0;
  $297 = ((($296)) + 40|0);
  $298 = +HEAPF32[$297>>2];
  $299 = ((($296)) + 52|0);
  $300 = +HEAPF32[$299>>2];
  $301 = $298 * $300;
  HEAPF32[$10>>2] = $301;
  $302 = HEAP32[11032]|0;
  $303 = ((($302)) + 32|0);
  $304 = +HEAPF32[$303>>2];
  $305 = ((($302)) + 60|0);
  $306 = +HEAPF32[$305>>2];
  $307 = $304 * $306;
  HEAPF32[$11>>2] = $307;
  $308 = HEAP32[11032]|0;
  $309 = ((($308)) + 44|0);
  $310 = +HEAPF32[$309>>2];
  $311 = ((($308)) + 48|0);
  $312 = +HEAPF32[$311>>2];
  $313 = $310 * $312;
  HEAPF32[$13>>2] = $313;
  $314 = HEAP32[11032]|0;
  $315 = ((($314)) + 32|0);
  $316 = +HEAPF32[$315>>2];
  $317 = ((($314)) + 56|0);
  $318 = +HEAPF32[$317>>2];
  $319 = $316 * $318;
  HEAPF32[$14>>2] = $319;
  $320 = HEAP32[11032]|0;
  $321 = ((($320)) + 40|0);
  $322 = +HEAPF32[$321>>2];
  $323 = ((($320)) + 48|0);
  $324 = +HEAPF32[$323>>2];
  $325 = $322 * $324;
  HEAPF32[$15>>2] = $325;
  $326 = HEAP32[11032]|0;
  $327 = ((($326)) + 32|0);
  $328 = +HEAPF32[$327>>2];
  $329 = ((($326)) + 52|0);
  $330 = +HEAPF32[$329>>2];
  $331 = $328 * $330;
  HEAPF32[$16>>2] = $331;
  $332 = HEAP32[11032]|0;
  $333 = ((($332)) + 36|0);
  $334 = +HEAPF32[$333>>2];
  $335 = ((($332)) + 48|0);
  $336 = +HEAPF32[$335>>2];
  $337 = $334 * $336;
  HEAPF32[$17>>2] = $337;
  $338 = +HEAPF32[$12>>2];
  $339 = HEAP32[11032]|0;
  $340 = ((($339)) + 20|0);
  $341 = +HEAPF32[$340>>2];
  $342 = $338 * $341;
  $343 = +HEAPF32[$18>>2];
  $344 = ((($339)) + 24|0);
  $345 = +HEAPF32[$344>>2];
  $346 = $343 * $345;
  $347 = $342 + $346;
  $348 = +HEAPF32[$19>>2];
  $349 = ((($339)) + 28|0);
  $350 = +HEAPF32[$349>>2];
  $351 = $348 * $350;
  $352 = $347 + $351;
  HEAPF32[$20>>2] = $352;
  $353 = +HEAPF32[$22>>2];
  $354 = HEAP32[11032]|0;
  $355 = ((($354)) + 20|0);
  $356 = +HEAPF32[$355>>2];
  $357 = $353 * $356;
  $358 = +HEAPF32[$23>>2];
  $359 = ((($354)) + 24|0);
  $360 = +HEAPF32[$359>>2];
  $361 = $358 * $360;
  $362 = $357 + $361;
  $363 = +HEAPF32[$24>>2];
  $364 = ((($354)) + 28|0);
  $365 = +HEAPF32[$364>>2];
  $366 = $363 * $365;
  $367 = $362 + $366;
  $368 = +HEAPF32[$20>>2];
  $369 = $368 - $367;
  HEAPF32[$20>>2] = $369;
  $370 = +HEAPF32[$25>>2];
  $371 = HEAP32[11032]|0;
  $372 = ((($371)) + 16|0);
  $373 = +HEAPF32[$372>>2];
  $374 = $370 * $373;
  $375 = +HEAPF32[$26>>2];
  $376 = ((($371)) + 24|0);
  $377 = +HEAPF32[$376>>2];
  $378 = $375 * $377;
  $379 = $374 + $378;
  $380 = +HEAPF32[$27>>2];
  $381 = ((($371)) + 28|0);
  $382 = +HEAPF32[$381>>2];
  $383 = $380 * $382;
  $384 = $379 + $383;
  HEAPF32[$29>>2] = $384;
  $385 = +HEAPF32[$30>>2];
  $386 = HEAP32[11032]|0;
  $387 = ((($386)) + 16|0);
  $388 = +HEAPF32[$387>>2];
  $389 = $385 * $388;
  $390 = +HEAPF32[$31>>2];
  $391 = ((($386)) + 24|0);
  $392 = +HEAPF32[$391>>2];
  $393 = $390 * $392;
  $394 = $389 + $393;
  $395 = +HEAPF32[$32>>2];
  $396 = ((($386)) + 28|0);
  $397 = +HEAPF32[$396>>2];
  $398 = $395 * $397;
  $399 = $394 + $398;
  $400 = +HEAPF32[$33>>2];
  $401 = $400 - $399;
  HEAPF32[$33>>2] = $401;
  $402 = +HEAPF32[$34>>2];
  $403 = HEAP32[11032]|0;
  $404 = ((($403)) + 16|0);
  $405 = +HEAPF32[$404>>2];
  $406 = $402 * $405;
  $407 = +HEAPF32[$35>>2];
  $408 = ((($403)) + 20|0);
  $409 = +HEAPF32[$408>>2];
  $410 = $407 * $409;
  $411 = $406 + $410;
  $412 = +HEAPF32[$36>>2];
  $413 = ((($403)) + 28|0);
  $414 = +HEAPF32[$413>>2];
  $415 = $412 * $414;
  $416 = $411 + $415;
  HEAPF32[$38>>2] = $416;
  $417 = +HEAPF32[$40>>2];
  $418 = HEAP32[11032]|0;
  $419 = ((($418)) + 16|0);
  $420 = +HEAPF32[$419>>2];
  $421 = $417 * $420;
  $422 = +HEAPF32[$41>>2];
  $423 = ((($418)) + 20|0);
  $424 = +HEAPF32[$423>>2];
  $425 = $422 * $424;
  $426 = $421 + $425;
  $427 = +HEAPF32[$42>>2];
  $428 = ((($418)) + 28|0);
  $429 = +HEAPF32[$428>>2];
  $430 = $427 * $429;
  $431 = $426 + $430;
  $432 = +HEAPF32[$43>>2];
  $433 = $432 - $431;
  HEAPF32[$43>>2] = $433;
  $434 = +HEAPF32[$44>>2];
  $435 = HEAP32[11032]|0;
  $436 = ((($435)) + 16|0);
  $437 = +HEAPF32[$436>>2];
  $438 = $434 * $437;
  $439 = +HEAPF32[$45>>2];
  $440 = ((($435)) + 20|0);
  $441 = +HEAPF32[$440>>2];
  $442 = $439 * $441;
  $443 = $438 + $442;
  $444 = +HEAPF32[$46>>2];
  $445 = ((($435)) + 24|0);
  $446 = +HEAPF32[$445>>2];
  $447 = $444 * $446;
  $448 = $443 + $447;
  HEAPF32[$48>>2] = $448;
  $449 = +HEAPF32[$50>>2];
  $450 = HEAP32[11032]|0;
  $451 = ((($450)) + 16|0);
  $452 = +HEAPF32[$451>>2];
  $453 = $449 * $452;
  $454 = +HEAPF32[$51>>2];
  $455 = ((($450)) + 20|0);
  $456 = +HEAPF32[$455>>2];
  $457 = $454 * $456;
  $458 = $453 + $457;
  $459 = +HEAPF32[$52>>2];
  $460 = ((($450)) + 24|0);
  $461 = +HEAPF32[$460>>2];
  $462 = $459 * $461;
  $463 = $458 + $462;
  $464 = +HEAPF32[$53>>2];
  $465 = $464 - $463;
  HEAPF32[$53>>2] = $465;
  $466 = +HEAPF32[$54>>2];
  $467 = HEAP32[11032]|0;
  $468 = ((($467)) + 4|0);
  $469 = +HEAPF32[$468>>2];
  $470 = $466 * $469;
  $471 = +HEAPF32[$55>>2];
  $472 = ((($467)) + 8|0);
  $473 = +HEAPF32[$472>>2];
  $474 = $471 * $473;
  $475 = $470 + $474;
  $476 = +HEAPF32[$56>>2];
  $477 = ((($467)) + 12|0);
  $478 = +HEAPF32[$477>>2];
  $479 = $476 * $478;
  $480 = $475 + $479;
  HEAPF32[$58>>2] = $480;
  $481 = +HEAPF32[$59>>2];
  $482 = HEAP32[11032]|0;
  $483 = ((($482)) + 4|0);
  $484 = +HEAPF32[$483>>2];
  $485 = $481 * $484;
  $486 = +HEAPF32[$60>>2];
  $487 = ((($482)) + 8|0);
  $488 = +HEAPF32[$487>>2];
  $489 = $486 * $488;
  $490 = $485 + $489;
  $491 = +HEAPF32[$61>>2];
  $492 = ((($482)) + 12|0);
  $493 = +HEAPF32[$492>>2];
  $494 = $491 * $493;
  $495 = $490 + $494;
  $496 = +HEAPF32[$62>>2];
  $497 = $496 - $495;
  HEAPF32[$62>>2] = $497;
  $498 = +HEAPF32[$59>>2];
  $499 = HEAP32[11032]|0;
  $500 = +HEAPF32[$499>>2];
  $501 = $498 * $500;
  $502 = +HEAPF32[$63>>2];
  $503 = ((($499)) + 8|0);
  $504 = +HEAPF32[$503>>2];
  $505 = $502 * $504;
  $506 = $501 + $505;
  $507 = +HEAPF32[$64>>2];
  $508 = ((($499)) + 12|0);
  $509 = +HEAPF32[$508>>2];
  $510 = $507 * $509;
  $511 = $506 + $510;
  HEAPF32[$66>>2] = $511;
  $512 = +HEAPF32[$68>>2];
  $513 = HEAP32[11032]|0;
  $514 = +HEAPF32[$513>>2];
  $515 = $512 * $514;
  $516 = +HEAPF32[$69>>2];
  $517 = ((($513)) + 8|0);
  $518 = +HEAPF32[$517>>2];
  $519 = $516 * $518;
  $520 = $515 + $519;
  $521 = +HEAPF32[$70>>2];
  $522 = ((($513)) + 12|0);
  $523 = +HEAPF32[$522>>2];
  $524 = $521 * $523;
  $525 = $520 + $524;
  $526 = +HEAPF32[$71>>2];
  $527 = $526 - $525;
  HEAPF32[$71>>2] = $527;
  $528 = +HEAPF32[$72>>2];
  $529 = HEAP32[11032]|0;
  $530 = +HEAPF32[$529>>2];
  $531 = $528 * $530;
  $532 = +HEAPF32[$73>>2];
  $533 = ((($529)) + 4|0);
  $534 = +HEAPF32[$533>>2];
  $535 = $532 * $534;
  $536 = $531 + $535;
  $537 = +HEAPF32[$74>>2];
  $538 = ((($529)) + 12|0);
  $539 = +HEAPF32[$538>>2];
  $540 = $537 * $539;
  $541 = $536 + $540;
  HEAPF32[$76>>2] = $541;
  $542 = +HEAPF32[$78>>2];
  $543 = HEAP32[11032]|0;
  $544 = +HEAPF32[$543>>2];
  $545 = $542 * $544;
  $546 = +HEAPF32[$79>>2];
  $547 = ((($543)) + 4|0);
  $548 = +HEAPF32[$547>>2];
  $549 = $546 * $548;
  $550 = $545 + $549;
  $551 = +HEAPF32[$80>>2];
  $552 = ((($543)) + 12|0);
  $553 = +HEAPF32[$552>>2];
  $554 = $551 * $553;
  $555 = $550 + $554;
  $556 = +HEAPF32[$81>>2];
  $557 = $556 - $555;
  HEAPF32[$81>>2] = $557;
  $558 = +HEAPF32[$82>>2];
  $559 = HEAP32[11032]|0;
  $560 = +HEAPF32[$559>>2];
  $561 = $558 * $560;
  $562 = +HEAPF32[$83>>2];
  $563 = ((($559)) + 4|0);
  $564 = +HEAPF32[$563>>2];
  $565 = $562 * $564;
  $566 = $561 + $565;
  $567 = +HEAPF32[$84>>2];
  $568 = ((($559)) + 8|0);
  $569 = +HEAPF32[$568>>2];
  $570 = $567 * $569;
  $571 = $566 + $570;
  HEAPF32[$86>>2] = $571;
  $572 = +HEAPF32[$88>>2];
  $573 = HEAP32[11032]|0;
  $574 = +HEAPF32[$573>>2];
  $575 = $572 * $574;
  $576 = +HEAPF32[$89>>2];
  $577 = ((($573)) + 4|0);
  $578 = +HEAPF32[$577>>2];
  $579 = $576 * $578;
  $580 = $575 + $579;
  $581 = +HEAPF32[$90>>2];
  $582 = ((($573)) + 8|0);
  $583 = +HEAPF32[$582>>2];
  $584 = $581 * $583;
  $585 = $580 + $584;
  $586 = +HEAPF32[$91>>2];
  $587 = $586 - $585;
  HEAPF32[$91>>2] = $587;
  $588 = HEAP32[11032]|0;
  $589 = ((($588)) + 8|0);
  $590 = +HEAPF32[$589>>2];
  $591 = ((($588)) + 28|0);
  $592 = +HEAPF32[$591>>2];
  $593 = $590 * $592;
  HEAPF32[$87>>2] = $593;
  $594 = HEAP32[11032]|0;
  $595 = ((($594)) + 12|0);
  $596 = +HEAPF32[$595>>2];
  $597 = ((($594)) + 24|0);
  $598 = +HEAPF32[$597>>2];
  $599 = $596 * $598;
  HEAPF32[$92>>2] = $599;
  $600 = HEAP32[11032]|0;
  $601 = ((($600)) + 4|0);
  $602 = +HEAPF32[$601>>2];
  $603 = ((($600)) + 28|0);
  $604 = +HEAPF32[$603>>2];
  $605 = $602 * $604;
  HEAPF32[$93>>2] = $605;
  $606 = HEAP32[11032]|0;
  $607 = ((($606)) + 12|0);
  $608 = +HEAPF32[$607>>2];
  $609 = ((($606)) + 20|0);
  $610 = +HEAPF32[$609>>2];
  $611 = $608 * $610;
  HEAPF32[$95>>2] = $611;
  $612 = HEAP32[11032]|0;
  $613 = ((($612)) + 4|0);
  $614 = +HEAPF32[$613>>2];
  $615 = ((($612)) + 24|0);
  $616 = +HEAPF32[$615>>2];
  $617 = $614 * $616;
  HEAPF32[$96>>2] = $617;
  $618 = HEAP32[11032]|0;
  $619 = ((($618)) + 8|0);
  $620 = +HEAPF32[$619>>2];
  $621 = ((($618)) + 20|0);
  $622 = +HEAPF32[$621>>2];
  $623 = $620 * $622;
  HEAPF32[$97>>2] = $623;
  $624 = HEAP32[11032]|0;
  $625 = +HEAPF32[$624>>2];
  $626 = ((($624)) + 28|0);
  $627 = +HEAPF32[$626>>2];
  $628 = $625 * $627;
  HEAPF32[$98>>2] = $628;
  $629 = HEAP32[11032]|0;
  $630 = ((($629)) + 12|0);
  $631 = +HEAPF32[$630>>2];
  $632 = ((($629)) + 16|0);
  $633 = +HEAPF32[$632>>2];
  $634 = $631 * $633;
  HEAPF32[$99>>2] = $634;
  $635 = HEAP32[11032]|0;
  $636 = +HEAPF32[$635>>2];
  $637 = ((($635)) + 24|0);
  $638 = +HEAPF32[$637>>2];
  $639 = $636 * $638;
  HEAPF32[$100>>2] = $639;
  $640 = HEAP32[11032]|0;
  $641 = ((($640)) + 8|0);
  $642 = +HEAPF32[$641>>2];
  $643 = ((($640)) + 16|0);
  $644 = +HEAPF32[$643>>2];
  $645 = $642 * $644;
  HEAPF32[$102>>2] = $645;
  $646 = HEAP32[11032]|0;
  $647 = +HEAPF32[$646>>2];
  $648 = ((($646)) + 20|0);
  $649 = +HEAPF32[$648>>2];
  $650 = $647 * $649;
  HEAPF32[$103>>2] = $650;
  $651 = HEAP32[11032]|0;
  $652 = ((($651)) + 4|0);
  $653 = +HEAPF32[$652>>2];
  $654 = ((($651)) + 16|0);
  $655 = +HEAPF32[$654>>2];
  $656 = $653 * $655;
  HEAPF32[$104>>2] = $656;
  $657 = +HEAPF32[$101>>2];
  $658 = HEAP32[11032]|0;
  $659 = ((($658)) + 52|0);
  $660 = +HEAPF32[$659>>2];
  $661 = $657 * $660;
  $662 = +HEAPF32[$105>>2];
  $663 = ((($658)) + 56|0);
  $664 = +HEAPF32[$663>>2];
  $665 = $662 * $664;
  $666 = $661 + $665;
  $667 = +HEAPF32[$106>>2];
  $668 = ((($658)) + 60|0);
  $669 = +HEAPF32[$668>>2];
  $670 = $667 * $669;
  $671 = $666 + $670;
  HEAPF32[$108>>2] = $671;
  $672 = +HEAPF32[$110>>2];
  $673 = HEAP32[11032]|0;
  $674 = ((($673)) + 52|0);
  $675 = +HEAPF32[$674>>2];
  $676 = $672 * $675;
  $677 = +HEAPF32[$111>>2];
  $678 = ((($673)) + 56|0);
  $679 = +HEAPF32[$678>>2];
  $680 = $677 * $679;
  $681 = $676 + $680;
  $682 = +HEAPF32[$112>>2];
  $683 = ((($673)) + 60|0);
  $684 = +HEAPF32[$683>>2];
  $685 = $682 * $684;
  $686 = $681 + $685;
  $687 = +HEAPF32[$113>>2];
  $688 = $687 - $686;
  HEAPF32[$113>>2] = $688;
  $689 = +HEAPF32[$114>>2];
  $690 = HEAP32[11032]|0;
  $691 = ((($690)) + 48|0);
  $692 = +HEAPF32[$691>>2];
  $693 = $689 * $692;
  $694 = +HEAPF32[$115>>2];
  $695 = ((($690)) + 56|0);
  $696 = +HEAPF32[$695>>2];
  $697 = $694 * $696;
  $698 = $693 + $697;
  $699 = +HEAPF32[$116>>2];
  $700 = ((($690)) + 60|0);
  $701 = +HEAPF32[$700>>2];
  $702 = $699 * $701;
  $703 = $698 + $702;
  HEAPF32[$118>>2] = $703;
  $704 = +HEAPF32[$119>>2];
  $705 = HEAP32[11032]|0;
  $706 = ((($705)) + 48|0);
  $707 = +HEAPF32[$706>>2];
  $708 = $704 * $707;
  $709 = +HEAPF32[$120>>2];
  $710 = ((($705)) + 56|0);
  $711 = +HEAPF32[$710>>2];
  $712 = $709 * $711;
  $713 = $708 + $712;
  $714 = +HEAPF32[$121>>2];
  $715 = ((($705)) + 60|0);
  $716 = +HEAPF32[$715>>2];
  $717 = $714 * $716;
  $718 = $713 + $717;
  $719 = +HEAPF32[$122>>2];
  $720 = $719 - $718;
  HEAPF32[$122>>2] = $720;
  $721 = +HEAPF32[$123>>2];
  $722 = HEAP32[11032]|0;
  $723 = ((($722)) + 48|0);
  $724 = +HEAPF32[$723>>2];
  $725 = $721 * $724;
  $726 = +HEAPF32[$124>>2];
  $727 = ((($722)) + 52|0);
  $728 = +HEAPF32[$727>>2];
  $729 = $726 * $728;
  $730 = $725 + $729;
  $731 = +HEAPF32[$125>>2];
  $732 = ((($722)) + 60|0);
  $733 = +HEAPF32[$732>>2];
  $734 = $731 * $733;
  $735 = $730 + $734;
  HEAPF32[$127>>2] = $735;
  $736 = +HEAPF32[$129>>2];
  $737 = HEAP32[11032]|0;
  $738 = ((($737)) + 48|0);
  $739 = +HEAPF32[$738>>2];
  $740 = $736 * $739;
  $741 = +HEAPF32[$130>>2];
  $742 = ((($737)) + 52|0);
  $743 = +HEAPF32[$742>>2];
  $744 = $741 * $743;
  $745 = $740 + $744;
  $746 = +HEAPF32[$131>>2];
  $747 = ((($737)) + 60|0);
  $748 = +HEAPF32[$747>>2];
  $749 = $746 * $748;
  $750 = $745 + $749;
  $751 = +HEAPF32[$132>>2];
  $752 = $751 - $750;
  HEAPF32[$132>>2] = $752;
  $753 = +HEAPF32[$133>>2];
  $754 = HEAP32[11032]|0;
  $755 = ((($754)) + 48|0);
  $756 = +HEAPF32[$755>>2];
  $757 = $753 * $756;
  $758 = +HEAPF32[$134>>2];
  $759 = ((($754)) + 52|0);
  $760 = +HEAPF32[$759>>2];
  $761 = $758 * $760;
  $762 = $757 + $761;
  $763 = +HEAPF32[$135>>2];
  $764 = ((($754)) + 56|0);
  $765 = +HEAPF32[$764>>2];
  $766 = $763 * $765;
  $767 = $762 + $766;
  HEAPF32[$137>>2] = $767;
  $768 = +HEAPF32[$139>>2];
  $769 = HEAP32[11032]|0;
  $770 = ((($769)) + 48|0);
  $771 = +HEAPF32[$770>>2];
  $772 = $768 * $771;
  $773 = +HEAPF32[$140>>2];
  $774 = ((($769)) + 52|0);
  $775 = +HEAPF32[$774>>2];
  $776 = $773 * $775;
  $777 = $772 + $776;
  $778 = +HEAPF32[$141>>2];
  $779 = ((($769)) + 56|0);
  $780 = +HEAPF32[$779>>2];
  $781 = $778 * $780;
  $782 = $777 + $781;
  $783 = +HEAPF32[$142>>2];
  $784 = $783 - $782;
  HEAPF32[$142>>2] = $784;
  $785 = +HEAPF32[$143>>2];
  $786 = HEAP32[11032]|0;
  $787 = ((($786)) + 40|0);
  $788 = +HEAPF32[$787>>2];
  $789 = $785 * $788;
  $790 = +HEAPF32[$144>>2];
  $791 = ((($786)) + 44|0);
  $792 = +HEAPF32[$791>>2];
  $793 = $790 * $792;
  $794 = $789 + $793;
  $795 = +HEAPF32[$145>>2];
  $796 = ((($786)) + 36|0);
  $797 = +HEAPF32[$796>>2];
  $798 = $795 * $797;
  $799 = $794 + $798;
  HEAPF32[$147>>2] = $799;
  $800 = +HEAPF32[$149>>2];
  $801 = HEAP32[11032]|0;
  $802 = ((($801)) + 44|0);
  $803 = +HEAPF32[$802>>2];
  $804 = $800 * $803;
  $805 = +HEAPF32[$148>>2];
  $806 = ((($801)) + 36|0);
  $807 = +HEAPF32[$806>>2];
  $808 = $805 * $807;
  $809 = $804 + $808;
  $810 = +HEAPF32[$150>>2];
  $811 = ((($801)) + 40|0);
  $812 = +HEAPF32[$811>>2];
  $813 = $810 * $812;
  $814 = $809 + $813;
  $815 = +HEAPF32[$151>>2];
  $816 = $815 - $814;
  HEAPF32[$151>>2] = $816;
  $817 = +HEAPF32[$152>>2];
  $818 = HEAP32[11032]|0;
  $819 = ((($818)) + 44|0);
  $820 = +HEAPF32[$819>>2];
  $821 = $817 * $820;
  $822 = +HEAPF32[$148>>2];
  $823 = ((($818)) + 32|0);
  $824 = +HEAPF32[$823>>2];
  $825 = $822 * $824;
  $826 = $821 + $825;
  $827 = +HEAPF32[$153>>2];
  $828 = ((($818)) + 40|0);
  $829 = +HEAPF32[$828>>2];
  $830 = $827 * $829;
  $831 = $826 + $830;
  HEAPF32[$155>>2] = $831;
  $832 = +HEAPF32[$157>>2];
  $833 = HEAP32[11032]|0;
  $834 = ((($833)) + 40|0);
  $835 = +HEAPF32[$834>>2];
  $836 = $832 * $835;
  $837 = +HEAPF32[$158>>2];
  $838 = ((($833)) + 44|0);
  $839 = +HEAPF32[$838>>2];
  $840 = $837 * $839;
  $841 = $836 + $840;
  $842 = +HEAPF32[$159>>2];
  $843 = ((($833)) + 32|0);
  $844 = +HEAPF32[$843>>2];
  $845 = $842 * $844;
  $846 = $841 + $845;
  $847 = +HEAPF32[$160>>2];
  $848 = $847 - $846;
  HEAPF32[$160>>2] = $848;
  $849 = +HEAPF32[$161>>2];
  $850 = HEAP32[11032]|0;
  $851 = ((($850)) + 36|0);
  $852 = +HEAPF32[$851>>2];
  $853 = $849 * $852;
  $854 = +HEAPF32[$162>>2];
  $855 = ((($850)) + 44|0);
  $856 = +HEAPF32[$855>>2];
  $857 = $854 * $856;
  $858 = $853 + $857;
  $859 = +HEAPF32[$163>>2];
  $860 = ((($850)) + 32|0);
  $861 = +HEAPF32[$860>>2];
  $862 = $859 * $861;
  $863 = $858 + $862;
  HEAPF32[$165>>2] = $863;
  $864 = +HEAPF32[$167>>2];
  $865 = HEAP32[11032]|0;
  $866 = ((($865)) + 44|0);
  $867 = +HEAPF32[$866>>2];
  $868 = $864 * $867;
  $869 = +HEAPF32[$168>>2];
  $870 = ((($865)) + 32|0);
  $871 = +HEAPF32[$870>>2];
  $872 = $869 * $871;
  $873 = $868 + $872;
  $874 = +HEAPF32[$169>>2];
  $875 = ((($865)) + 36|0);
  $876 = +HEAPF32[$875>>2];
  $877 = $874 * $876;
  $878 = $873 + $877;
  $879 = +HEAPF32[$170>>2];
  $880 = $879 - $878;
  HEAPF32[$170>>2] = $880;
  $881 = +HEAPF32[$171>>2];
  $882 = HEAP32[11032]|0;
  $883 = ((($882)) + 40|0);
  $884 = +HEAPF32[$883>>2];
  $885 = $881 * $884;
  $886 = +HEAPF32[$172>>2];
  $887 = ((($882)) + 32|0);
  $888 = +HEAPF32[$887>>2];
  $889 = $886 * $888;
  $890 = $885 + $889;
  $891 = +HEAPF32[$173>>2];
  $892 = ((($882)) + 36|0);
  $893 = +HEAPF32[$892>>2];
  $894 = $891 * $893;
  $895 = $890 + $894;
  HEAPF32[$175>>2] = $895;
  $896 = +HEAPF32[$177>>2];
  $897 = HEAP32[11032]|0;
  $898 = ((($897)) + 36|0);
  $899 = +HEAPF32[$898>>2];
  $900 = $896 * $899;
  $901 = +HEAPF32[$178>>2];
  $902 = ((($897)) + 40|0);
  $903 = +HEAPF32[$902>>2];
  $904 = $901 * $903;
  $905 = $900 + $904;
  $906 = +HEAPF32[$179>>2];
  $907 = ((($897)) + 32|0);
  $908 = +HEAPF32[$907>>2];
  $909 = $906 * $908;
  $910 = $905 + $909;
  $911 = +HEAPF32[$180>>2];
  $912 = $911 - $910;
  HEAPF32[$180>>2] = $912;
  $913 = HEAP32[11032]|0;
  $914 = +HEAPF32[$913>>2];
  $915 = +HEAPF32[$181>>2];
  $916 = $914 * $915;
  $917 = ((($913)) + 4|0);
  $918 = +HEAPF32[$917>>2];
  $919 = +HEAPF32[$182>>2];
  $920 = $918 * $919;
  $921 = $916 + $920;
  $922 = ((($913)) + 8|0);
  $923 = +HEAPF32[$922>>2];
  $924 = +HEAPF32[$183>>2];
  $925 = $923 * $924;
  $926 = $921 + $925;
  $927 = ((($913)) + 12|0);
  $928 = +HEAPF32[$927>>2];
  $929 = +HEAPF32[$184>>2];
  $930 = $928 * $929;
  $931 = $926 + $930;
  $932 = 1.0 / $931;
  $933 = +HEAPF32[$181>>2];
  $934 = $932 * $933;
  HEAPF32[$181>>2] = $934;
  $935 = +HEAPF32[$191>>2];
  $936 = $932 * $935;
  HEAPF32[$191>>2] = $936;
  $937 = +HEAPF32[$192>>2];
  $938 = $932 * $937;
  HEAPF32[$192>>2] = $938;
  $939 = +HEAPF32[$193>>2];
  $940 = $932 * $939;
  HEAPF32[$193>>2] = $940;
  $941 = +HEAPF32[$194>>2];
  $942 = $932 * $941;
  HEAPF32[$194>>2] = $942;
  $943 = +HEAPF32[$195>>2];
  $944 = $932 * $943;
  HEAPF32[$195>>2] = $944;
  $945 = +HEAPF32[$196>>2];
  $946 = $932 * $945;
  HEAPF32[$196>>2] = $946;
  $947 = +HEAPF32[$197>>2];
  $948 = $932 * $947;
  HEAPF32[$197>>2] = $948;
  $949 = +HEAPF32[$198>>2];
  $950 = $932 * $949;
  HEAPF32[$198>>2] = $950;
  $951 = +HEAPF32[$199>>2];
  $952 = $932 * $951;
  HEAPF32[$199>>2] = $952;
  $953 = +HEAPF32[$200>>2];
  $954 = $932 * $953;
  HEAPF32[$200>>2] = $954;
  $955 = +HEAPF32[$201>>2];
  $956 = $932 * $955;
  HEAPF32[$201>>2] = $956;
  $957 = +HEAPF32[$202>>2];
  $958 = $932 * $957;
  HEAPF32[$202>>2] = $958;
  $959 = +HEAPF32[$203>>2];
  $960 = $932 * $959;
  HEAPF32[$203>>2] = $960;
  $961 = +HEAPF32[$204>>2];
  $962 = $932 * $961;
  HEAPF32[$204>>2] = $962;
  $963 = +HEAPF32[$205>>2];
  $964 = $932 * $963;
  HEAPF32[$205>>2] = $964;
  $967 = (_i64Add(($965|0),($966|0),1,0)|0);
  $968 = tempRet0;
  $969 = ($968>>>0)<($1>>>0);
  $970 = ($967>>>0)<($0>>>0);
  $971 = ($968|0)==($1|0);
  $972 = $971 & $970;
  $973 = $969 | $972;
  if ($973) {
   $965 = $967;$966 = $968;
  } else {
   break;
  }
 }
 $206 = (_i64Add(($187|0),($190|0),($0|0),($1|0))|0);
 $207 = tempRet0;
 $208 = 4024;
 $209 = $208;
 HEAP32[$209>>2] = $206;
 $210 = (($208) + 4)|0;
 $211 = $210;
 HEAP32[$211>>2] = $207;
 $212 = 4024;
 $213 = $212;
 $214 = HEAP32[$213>>2]|0;
 $215 = (($212) + 4)|0;
 $216 = $215;
 $217 = HEAP32[$216>>2]|0;
 tempRet0 = ($217);
 return ($214|0);
}
function __ZN13MatrixInverse15matrixInverse64Ey($0,$1) {
 $0 = $0|0;
 $1 = $1|0;
 var $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0;
 var $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0;
 var $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0;
 var $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0, $170 = 0, $171 = 0;
 var $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0;
 var $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0;
 var $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0;
 var $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0;
 var $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0;
 var $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0, $279 = 0, $28 = 0;
 var $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0, $297 = 0, $298 = 0;
 var $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0, $314 = 0, $315 = 0;
 var $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0, $331 = 0, $332 = 0, $333 = 0;
 var $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0, $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0, $348 = 0, $349 = 0, $35 = 0, $350 = 0, $351 = 0;
 var $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0, $358 = 0, $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0, $363 = 0, $364 = 0, $365 = 0, $366 = 0, $367 = 0, $368 = 0, $369 = 0, $37 = 0;
 var $370 = 0, $371 = 0, $372 = 0, $373 = 0, $374 = 0, $375 = 0, $376 = 0, $377 = 0, $378 = 0, $379 = 0, $38 = 0, $380 = 0, $381 = 0, $382 = 0, $383 = 0, $384 = 0, $385 = 0, $386 = 0, $387 = 0, $388 = 0;
 var $389 = 0, $39 = 0, $390 = 0, $391 = 0, $392 = 0, $393 = 0, $394 = 0, $395 = 0, $396 = 0, $397 = 0, $398 = 0, $399 = 0, $4 = 0, $40 = 0, $400 = 0, $401 = 0, $402 = 0, $403 = 0, $404 = 0, $405 = 0;
 var $406 = 0, $407 = 0, $408 = 0, $409 = 0, $41 = 0, $410 = 0, $411 = 0, $412 = 0, $413 = 0, $414 = 0, $415 = 0, $416 = 0, $417 = 0, $418 = 0, $419 = 0, $42 = 0, $420 = 0, $421 = 0, $422 = 0, $423 = 0;
 var $424 = 0, $425 = 0, $426 = 0, $427 = 0, $428 = 0, $429 = 0, $43 = 0, $430 = 0, $431 = 0, $432 = 0, $433 = 0, $434 = 0, $435 = 0, $436 = 0, $437 = 0, $438 = 0, $439 = 0, $44 = 0, $440 = 0, $441 = 0;
 var $442 = 0, $443 = 0, $444 = 0, $445 = 0, $446 = 0, $447 = 0, $448 = 0, $449 = 0, $45 = 0, $450 = 0, $451 = 0, $452 = 0, $453 = 0, $454 = 0, $455 = 0, $456 = 0, $457 = 0, $458 = 0, $459 = 0, $46 = 0;
 var $460 = 0, $461 = 0, $462 = 0, $463 = 0, $464 = 0, $465 = 0, $466 = 0, $467 = 0.0, $468 = 0.0, $469 = 0.0, $47 = 0, $470 = 0.0, $471 = 0.0, $472 = 0.0, $473 = 0.0, $474 = 0.0, $475 = 0.0, $476 = 0.0, $477 = 0.0, $478 = 0.0;
 var $479 = 0.0, $48 = 0, $480 = 0.0, $481 = 0.0, $482 = 0.0, $483 = 0.0, $484 = 0.0, $485 = 0.0, $486 = 0.0, $487 = 0.0, $488 = 0.0, $489 = 0.0, $49 = 0, $490 = 0.0, $491 = 0.0, $492 = 0.0, $493 = 0.0, $494 = 0.0, $495 = 0.0, $496 = 0.0;
 var $497 = 0.0, $498 = 0.0, $499 = 0.0, $5 = 0, $50 = 0, $500 = 0.0, $501 = 0.0, $502 = 0.0, $503 = 0.0, $504 = 0.0, $505 = 0.0, $506 = 0.0, $507 = 0.0, $508 = 0.0, $509 = 0.0, $51 = 0, $510 = 0.0, $511 = 0.0, $512 = 0.0, $513 = 0.0;
 var $514 = 0.0, $515 = 0.0, $516 = 0.0, $517 = 0.0, $518 = 0.0, $519 = 0.0, $52 = 0, $520 = 0.0, $521 = 0.0, $522 = 0.0, $523 = 0.0, $524 = 0.0, $525 = 0.0, $526 = 0.0, $527 = 0.0, $528 = 0.0, $529 = 0.0, $53 = 0, $530 = 0.0, $531 = 0.0;
 var $532 = 0.0, $533 = 0.0, $534 = 0.0, $535 = 0.0, $536 = 0.0, $537 = 0.0, $538 = 0.0, $539 = 0.0, $54 = 0, $540 = 0.0, $541 = 0.0, $542 = 0.0, $543 = 0.0, $544 = 0.0, $545 = 0.0, $546 = 0.0, $547 = 0.0, $548 = 0.0, $549 = 0.0, $55 = 0;
 var $550 = 0.0, $551 = 0.0, $552 = 0.0, $553 = 0.0, $554 = 0.0, $555 = 0.0, $556 = 0.0, $557 = 0.0, $558 = 0.0, $559 = 0.0, $56 = 0, $560 = 0.0, $561 = 0.0, $562 = 0.0, $563 = 0.0, $564 = 0.0, $565 = 0.0, $566 = 0.0, $567 = 0.0, $568 = 0.0;
 var $569 = 0.0, $57 = 0, $570 = 0.0, $571 = 0.0, $572 = 0.0, $573 = 0.0, $574 = 0.0, $575 = 0.0, $576 = 0.0, $577 = 0.0, $578 = 0.0, $579 = 0.0, $58 = 0, $580 = 0.0, $581 = 0.0, $582 = 0.0, $583 = 0.0, $584 = 0.0, $585 = 0.0, $586 = 0.0;
 var $587 = 0.0, $588 = 0.0, $589 = 0.0, $59 = 0, $590 = 0.0, $591 = 0.0, $592 = 0.0, $593 = 0.0, $594 = 0.0, $595 = 0.0, $596 = 0.0, $597 = 0.0, $598 = 0.0, $599 = 0.0, $6 = 0, $60 = 0, $600 = 0.0, $601 = 0.0, $602 = 0.0, $603 = 0.0;
 var $604 = 0.0, $605 = 0.0, $606 = 0.0, $607 = 0.0, $608 = 0.0, $609 = 0.0, $61 = 0, $610 = 0.0, $611 = 0.0, $612 = 0.0, $613 = 0.0, $614 = 0.0, $615 = 0.0, $616 = 0.0, $617 = 0.0, $618 = 0.0, $619 = 0.0, $62 = 0, $620 = 0.0, $621 = 0.0;
 var $622 = 0.0, $623 = 0.0, $624 = 0.0, $625 = 0.0, $626 = 0.0, $627 = 0.0, $628 = 0.0, $629 = 0.0, $63 = 0, $630 = 0.0, $631 = 0.0, $632 = 0.0, $633 = 0.0, $634 = 0.0, $635 = 0.0, $636 = 0.0, $637 = 0.0, $638 = 0.0, $639 = 0.0, $64 = 0;
 var $640 = 0.0, $641 = 0.0, $642 = 0.0, $643 = 0.0, $644 = 0.0, $645 = 0.0, $646 = 0.0, $647 = 0.0, $648 = 0.0, $649 = 0.0, $65 = 0, $650 = 0.0, $651 = 0.0, $652 = 0.0, $653 = 0.0, $654 = 0.0, $655 = 0.0, $656 = 0.0, $657 = 0.0, $658 = 0.0;
 var $659 = 0.0, $66 = 0, $660 = 0.0, $661 = 0.0, $662 = 0.0, $663 = 0.0, $664 = 0.0, $665 = 0.0, $666 = 0.0, $667 = 0.0, $668 = 0.0, $669 = 0.0, $67 = 0, $670 = 0.0, $671 = 0.0, $672 = 0.0, $673 = 0.0, $674 = 0.0, $675 = 0.0, $676 = 0.0;
 var $677 = 0.0, $678 = 0.0, $679 = 0.0, $68 = 0, $680 = 0.0, $681 = 0.0, $682 = 0.0, $683 = 0.0, $684 = 0.0, $685 = 0.0, $686 = 0.0, $687 = 0.0, $688 = 0.0, $689 = 0.0, $69 = 0, $690 = 0.0, $691 = 0.0, $692 = 0.0, $693 = 0.0, $694 = 0.0;
 var $695 = 0.0, $696 = 0.0, $697 = 0.0, $698 = 0.0, $699 = 0.0, $7 = 0, $70 = 0, $700 = 0.0, $701 = 0.0, $702 = 0.0, $703 = 0.0, $704 = 0.0, $705 = 0.0, $706 = 0.0, $707 = 0.0, $708 = 0.0, $709 = 0.0, $71 = 0, $710 = 0.0, $711 = 0.0;
 var $712 = 0.0, $713 = 0.0, $714 = 0.0, $715 = 0.0, $716 = 0.0, $717 = 0.0, $718 = 0.0, $719 = 0.0, $72 = 0, $720 = 0.0, $721 = 0.0, $722 = 0.0, $723 = 0.0, $724 = 0.0, $725 = 0.0, $726 = 0.0, $727 = 0.0, $728 = 0.0, $729 = 0.0, $73 = 0;
 var $730 = 0.0, $731 = 0.0, $732 = 0.0, $733 = 0.0, $734 = 0.0, $735 = 0.0, $736 = 0.0, $737 = 0.0, $738 = 0.0, $739 = 0.0, $74 = 0, $740 = 0.0, $741 = 0.0, $742 = 0.0, $743 = 0.0, $744 = 0.0, $745 = 0.0, $746 = 0.0, $747 = 0.0, $748 = 0.0;
 var $749 = 0.0, $75 = 0, $750 = 0.0, $751 = 0.0, $752 = 0.0, $753 = 0.0, $754 = 0.0, $755 = 0.0, $756 = 0.0, $757 = 0.0, $758 = 0.0, $759 = 0.0, $76 = 0, $760 = 0.0, $761 = 0.0, $762 = 0.0, $763 = 0.0, $764 = 0.0, $765 = 0.0, $766 = 0.0;
 var $767 = 0.0, $768 = 0.0, $769 = 0.0, $77 = 0, $770 = 0.0, $771 = 0.0, $772 = 0.0, $773 = 0.0, $774 = 0.0, $775 = 0.0, $776 = 0.0, $777 = 0.0, $778 = 0.0, $779 = 0.0, $78 = 0, $780 = 0.0, $781 = 0.0, $782 = 0.0, $783 = 0.0, $784 = 0.0;
 var $785 = 0.0, $786 = 0.0, $787 = 0.0, $788 = 0.0, $789 = 0.0, $79 = 0, $790 = 0.0, $791 = 0.0, $792 = 0.0, $793 = 0.0, $794 = 0.0, $795 = 0.0, $796 = 0.0, $797 = 0.0, $798 = 0.0, $799 = 0.0, $8 = 0, $80 = 0, $800 = 0.0, $801 = 0.0;
 var $802 = 0.0, $803 = 0.0, $804 = 0.0, $805 = 0.0, $806 = 0.0, $807 = 0.0, $808 = 0.0, $809 = 0.0, $81 = 0, $810 = 0.0, $811 = 0.0, $812 = 0.0, $813 = 0.0, $814 = 0.0, $815 = 0.0, $816 = 0.0, $817 = 0.0, $818 = 0.0, $819 = 0.0, $82 = 0;
 var $820 = 0.0, $821 = 0.0, $822 = 0.0, $823 = 0.0, $824 = 0.0, $825 = 0.0, $826 = 0.0, $827 = 0.0, $828 = 0.0, $829 = 0.0, $83 = 0, $830 = 0.0, $831 = 0.0, $832 = 0.0, $833 = 0.0, $834 = 0.0, $835 = 0.0, $836 = 0.0, $837 = 0.0, $838 = 0.0;
 var $839 = 0.0, $84 = 0, $840 = 0.0, $841 = 0.0, $842 = 0.0, $843 = 0.0, $844 = 0.0, $845 = 0.0, $846 = 0.0, $847 = 0.0, $848 = 0.0, $849 = 0.0, $85 = 0, $850 = 0.0, $851 = 0.0, $852 = 0.0, $853 = 0.0, $854 = 0.0, $855 = 0.0, $856 = 0.0;
 var $857 = 0.0, $858 = 0.0, $859 = 0.0, $86 = 0, $860 = 0.0, $861 = 0.0, $862 = 0.0, $863 = 0.0, $864 = 0.0, $865 = 0.0, $866 = 0.0, $867 = 0.0, $868 = 0.0, $869 = 0.0, $87 = 0, $870 = 0.0, $871 = 0.0, $872 = 0.0, $873 = 0.0, $874 = 0.0;
 var $875 = 0.0, $876 = 0.0, $877 = 0.0, $878 = 0.0, $879 = 0.0, $88 = 0, $880 = 0.0, $881 = 0.0, $882 = 0.0, $883 = 0.0, $884 = 0.0, $885 = 0.0, $886 = 0.0, $887 = 0.0, $888 = 0.0, $889 = 0.0, $89 = 0, $890 = 0.0, $891 = 0.0, $892 = 0.0;
 var $893 = 0.0, $894 = 0.0, $895 = 0.0, $896 = 0.0, $897 = 0.0, $898 = 0.0, $899 = 0.0, $9 = 0, $90 = 0, $900 = 0.0, $901 = 0.0, $902 = 0.0, $903 = 0.0, $904 = 0.0, $905 = 0.0, $906 = 0.0, $907 = 0.0, $908 = 0.0, $909 = 0.0, $91 = 0;
 var $910 = 0.0, $911 = 0.0, $912 = 0.0, $913 = 0.0, $914 = 0.0, $915 = 0.0, $916 = 0.0, $917 = 0.0, $918 = 0.0, $919 = 0.0, $92 = 0, $920 = 0.0, $921 = 0.0, $922 = 0.0, $923 = 0.0, $924 = 0.0, $925 = 0.0, $926 = 0.0, $927 = 0.0, $928 = 0.0;
 var $929 = 0.0, $93 = 0, $930 = 0.0, $931 = 0.0, $932 = 0.0, $933 = 0.0, $934 = 0.0, $935 = 0.0, $936 = 0.0, $937 = 0.0, $938 = 0.0, $939 = 0.0, $94 = 0, $940 = 0.0, $941 = 0.0, $942 = 0.0, $943 = 0.0, $944 = 0.0, $945 = 0.0, $946 = 0.0;
 var $947 = 0.0, $948 = 0.0, $949 = 0.0, $95 = 0, $950 = 0.0, $951 = 0.0, $952 = 0.0, $953 = 0.0, $954 = 0.0, $955 = 0.0, $956 = 0.0, $957 = 0.0, $958 = 0.0, $959 = 0.0, $96 = 0, $960 = 0.0, $961 = 0.0, $962 = 0.0, $963 = 0.0, $964 = 0.0;
 var $965 = 0.0, $966 = 0.0, $967 = 0.0, $968 = 0.0, $969 = 0.0, $97 = 0, $970 = 0.0, $971 = 0.0, $972 = 0.0, $973 = 0.0, $974 = 0.0, $975 = 0.0, $976 = 0.0, $977 = 0.0, $978 = 0.0, $979 = 0.0, $98 = 0, $980 = 0.0, $981 = 0.0, $982 = 0.0;
 var $983 = 0.0, $984 = 0.0, $985 = 0.0, $986 = 0, $987 = 0, $988 = 0, $989 = 0, $99 = 0, $990 = 0, $991 = 0, $992 = 0, $993 = 0, $994 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($0|0)==(0);
 $3 = ($1|0)==(0);
 $4 = $2 & $3;
 if ($4) {
  $461 = 4024;
  $462 = $461;
  $463 = HEAP32[$462>>2]|0;
  $464 = (($461) + 4)|0;
  $465 = $464;
  $466 = HEAP32[$465>>2]|0;
  tempRet0 = ($466);
  return ($463|0);
 }
 $5 = HEAP32[11027]|0;
 $6 = HEAP32[11033]|0;
 $7 = ((($6)) + 80|0);
 $8 = HEAP32[11036]|0;
 $9 = ((($6)) + 88|0);
 $10 = ((($6)) + 112|0);
 $11 = ((($8)) + 8|0);
 $12 = ((($6)) + 72|0);
 $13 = ((($6)) + 120|0);
 $14 = ((($8)) + 16|0);
 $15 = ((($6)) + 88|0);
 $16 = ((($6)) + 104|0);
 $17 = ((($8)) + 24|0);
 $18 = HEAP32[11033]|0;
 $19 = ((($18)) + 72|0);
 $20 = ((($18)) + 112|0);
 $21 = HEAP32[11036]|0;
 $22 = ((($21)) + 32|0);
 $23 = ((($18)) + 80|0);
 $24 = ((($18)) + 104|0);
 $25 = ((($21)) + 40|0);
 $26 = HEAP32[11033]|0;
 $27 = ((($26)) + 64|0);
 $28 = ((($26)) + 120|0);
 $29 = HEAP32[11036]|0;
 $30 = ((($29)) + 48|0);
 $31 = ((($26)) + 88|0);
 $32 = ((($26)) + 96|0);
 $33 = ((($29)) + 56|0);
 $34 = HEAP32[11033]|0;
 $35 = ((($34)) + 64|0);
 $36 = ((($34)) + 112|0);
 $37 = HEAP32[11036]|0;
 $38 = ((($37)) + 64|0);
 $39 = ((($34)) + 80|0);
 $40 = ((($34)) + 96|0);
 $41 = ((($37)) + 72|0);
 $42 = HEAP32[11033]|0;
 $43 = ((($42)) + 64|0);
 $44 = ((($42)) + 104|0);
 $45 = HEAP32[11036]|0;
 $46 = ((($45)) + 80|0);
 $47 = ((($42)) + 72|0);
 $48 = ((($42)) + 96|0);
 $49 = ((($45)) + 88|0);
 $50 = HEAP32[11033]|0;
 $51 = ((($50)) + 40|0);
 $52 = ((($45)) + 24|0);
 $53 = ((($50)) + 48|0);
 $54 = ((($45)) + 32|0);
 $55 = ((($50)) + 56|0);
 $56 = HEAP32[11030]|0;
 $57 = HEAP32[11036]|0;
 $58 = ((($57)) + 8|0);
 $59 = HEAP32[11033]|0;
 $60 = ((($59)) + 40|0);
 $61 = ((($57)) + 16|0);
 $62 = ((($59)) + 48|0);
 $63 = ((($57)) + 40|0);
 $64 = ((($59)) + 56|0);
 $65 = HEAP32[11030]|0;
 $66 = HEAP32[11036]|0;
 $67 = ((($66)) + 8|0);
 $68 = HEAP32[11033]|0;
 $69 = ((($68)) + 32|0);
 $70 = ((($66)) + 48|0);
 $71 = ((($68)) + 48|0);
 $72 = ((($66)) + 72|0);
 $73 = ((($68)) + 56|0);
 $74 = HEAP32[11030]|0;
 $75 = ((($74)) + 8|0);
 $76 = HEAP32[11036]|0;
 $77 = HEAP32[11033]|0;
 $78 = ((($77)) + 32|0);
 $79 = ((($76)) + 56|0);
 $80 = ((($77)) + 48|0);
 $81 = ((($76)) + 64|0);
 $82 = ((($77)) + 56|0);
 $83 = HEAP32[11030]|0;
 $84 = ((($83)) + 8|0);
 $85 = HEAP32[11036]|0;
 $86 = ((($85)) + 16|0);
 $87 = HEAP32[11033]|0;
 $88 = ((($87)) + 32|0);
 $89 = ((($85)) + 56|0);
 $90 = ((($87)) + 40|0);
 $91 = ((($85)) + 80|0);
 $92 = ((($87)) + 56|0);
 $93 = HEAP32[11030]|0;
 $94 = ((($93)) + 16|0);
 $95 = HEAP32[11036]|0;
 $96 = ((($95)) + 24|0);
 $97 = HEAP32[11033]|0;
 $98 = ((($97)) + 32|0);
 $99 = ((($95)) + 48|0);
 $100 = ((($97)) + 40|0);
 $101 = ((($95)) + 88|0);
 $102 = ((($97)) + 56|0);
 $103 = HEAP32[11030]|0;
 $104 = ((($103)) + 16|0);
 $105 = HEAP32[11036]|0;
 $106 = ((($105)) + 40|0);
 $107 = HEAP32[11033]|0;
 $108 = ((($107)) + 32|0);
 $109 = ((($105)) + 64|0);
 $110 = ((($107)) + 40|0);
 $111 = ((($105)) + 88|0);
 $112 = ((($107)) + 48|0);
 $113 = HEAP32[11030]|0;
 $114 = ((($113)) + 24|0);
 $115 = HEAP32[11036]|0;
 $116 = ((($115)) + 32|0);
 $117 = HEAP32[11033]|0;
 $118 = ((($117)) + 32|0);
 $119 = ((($115)) + 72|0);
 $120 = ((($117)) + 40|0);
 $121 = ((($115)) + 80|0);
 $122 = ((($117)) + 48|0);
 $123 = HEAP32[11030]|0;
 $124 = ((($123)) + 24|0);
 $125 = HEAP32[11036]|0;
 $126 = ((($125)) + 8|0);
 $127 = HEAP32[11033]|0;
 $128 = ((($127)) + 8|0);
 $129 = ((($125)) + 16|0);
 $130 = ((($127)) + 16|0);
 $131 = ((($125)) + 40|0);
 $132 = ((($127)) + 24|0);
 $133 = HEAP32[11030]|0;
 $134 = ((($133)) + 32|0);
 $135 = HEAP32[11036]|0;
 $136 = HEAP32[11033]|0;
 $137 = ((($136)) + 8|0);
 $138 = ((($135)) + 24|0);
 $139 = ((($136)) + 16|0);
 $140 = ((($135)) + 32|0);
 $141 = ((($136)) + 24|0);
 $142 = HEAP32[11030]|0;
 $143 = ((($142)) + 32|0);
 $144 = HEAP32[11036]|0;
 $145 = HEAP32[11033]|0;
 $146 = ((($144)) + 56|0);
 $147 = ((($145)) + 16|0);
 $148 = ((($144)) + 64|0);
 $149 = ((($145)) + 24|0);
 $150 = HEAP32[11030]|0;
 $151 = ((($150)) + 40|0);
 $152 = HEAP32[11036]|0;
 $153 = ((($152)) + 8|0);
 $154 = HEAP32[11033]|0;
 $155 = ((($152)) + 48|0);
 $156 = ((($154)) + 16|0);
 $157 = ((($152)) + 72|0);
 $158 = ((($154)) + 24|0);
 $159 = HEAP32[11030]|0;
 $160 = ((($159)) + 40|0);
 $161 = HEAP32[11036]|0;
 $162 = ((($161)) + 24|0);
 $163 = HEAP32[11033]|0;
 $164 = ((($161)) + 48|0);
 $165 = ((($163)) + 8|0);
 $166 = ((($161)) + 88|0);
 $167 = ((($163)) + 24|0);
 $168 = HEAP32[11030]|0;
 $169 = ((($168)) + 48|0);
 $170 = HEAP32[11036]|0;
 $171 = ((($170)) + 16|0);
 $172 = HEAP32[11033]|0;
 $173 = ((($170)) + 56|0);
 $174 = ((($172)) + 8|0);
 $175 = ((($170)) + 80|0);
 $176 = ((($172)) + 24|0);
 $177 = HEAP32[11030]|0;
 $178 = ((($177)) + 48|0);
 $179 = HEAP32[11036]|0;
 $180 = ((($179)) + 32|0);
 $181 = HEAP32[11033]|0;
 $182 = ((($179)) + 72|0);
 $183 = ((($181)) + 8|0);
 $184 = ((($179)) + 80|0);
 $185 = ((($181)) + 16|0);
 $186 = HEAP32[11030]|0;
 $187 = ((($186)) + 56|0);
 $188 = HEAP32[11036]|0;
 $189 = ((($188)) + 40|0);
 $190 = HEAP32[11033]|0;
 $191 = ((($188)) + 64|0);
 $192 = ((($190)) + 8|0);
 $193 = ((($188)) + 88|0);
 $194 = ((($190)) + 16|0);
 $195 = HEAP32[11030]|0;
 $196 = ((($195)) + 56|0);
 $197 = HEAP32[11033]|0;
 $198 = ((($197)) + 16|0);
 $199 = ((($197)) + 56|0);
 $200 = HEAP32[11036]|0;
 $201 = ((($197)) + 24|0);
 $202 = ((($197)) + 48|0);
 $203 = ((($200)) + 8|0);
 $204 = HEAP32[11033]|0;
 $205 = ((($204)) + 8|0);
 $206 = ((($204)) + 56|0);
 $207 = HEAP32[11036]|0;
 $208 = ((($207)) + 16|0);
 $209 = ((($204)) + 24|0);
 $210 = ((($204)) + 40|0);
 $211 = ((($207)) + 24|0);
 $212 = HEAP32[11033]|0;
 $213 = ((($212)) + 8|0);
 $214 = ((($212)) + 48|0);
 $215 = HEAP32[11036]|0;
 $216 = ((($215)) + 32|0);
 $217 = ((($212)) + 16|0);
 $218 = ((($212)) + 40|0);
 $219 = ((($215)) + 40|0);
 $220 = HEAP32[11033]|0;
 $221 = ((($220)) + 56|0);
 $222 = HEAP32[11036]|0;
 $223 = ((($222)) + 48|0);
 $224 = ((($220)) + 24|0);
 $225 = ((($220)) + 32|0);
 $226 = ((($222)) + 56|0);
 $227 = HEAP32[11033]|0;
 $228 = ((($227)) + 48|0);
 $229 = HEAP32[11036]|0;
 $230 = ((($229)) + 64|0);
 $231 = ((($227)) + 16|0);
 $232 = ((($227)) + 32|0);
 $233 = ((($229)) + 72|0);
 $234 = HEAP32[11033]|0;
 $235 = ((($234)) + 40|0);
 $236 = HEAP32[11036]|0;
 $237 = ((($236)) + 80|0);
 $238 = ((($234)) + 8|0);
 $239 = ((($234)) + 32|0);
 $240 = ((($236)) + 88|0);
 $241 = HEAP32[11033]|0;
 $242 = ((($241)) + 104|0);
 $243 = ((($236)) + 24|0);
 $244 = ((($241)) + 112|0);
 $245 = ((($236)) + 32|0);
 $246 = ((($241)) + 120|0);
 $247 = HEAP32[11030]|0;
 $248 = ((($247)) + 64|0);
 $249 = HEAP32[11036]|0;
 $250 = ((($249)) + 8|0);
 $251 = HEAP32[11033]|0;
 $252 = ((($251)) + 104|0);
 $253 = ((($249)) + 16|0);
 $254 = ((($251)) + 112|0);
 $255 = ((($249)) + 40|0);
 $256 = ((($251)) + 120|0);
 $257 = HEAP32[11030]|0;
 $258 = ((($257)) + 64|0);
 $259 = HEAP32[11036]|0;
 $260 = ((($259)) + 8|0);
 $261 = HEAP32[11033]|0;
 $262 = ((($261)) + 96|0);
 $263 = ((($259)) + 48|0);
 $264 = ((($261)) + 112|0);
 $265 = ((($259)) + 72|0);
 $266 = ((($261)) + 120|0);
 $267 = HEAP32[11030]|0;
 $268 = ((($267)) + 72|0);
 $269 = HEAP32[11036]|0;
 $270 = HEAP32[11033]|0;
 $271 = ((($270)) + 96|0);
 $272 = ((($269)) + 56|0);
 $273 = ((($270)) + 112|0);
 $274 = ((($269)) + 64|0);
 $275 = ((($270)) + 120|0);
 $276 = HEAP32[11030]|0;
 $277 = ((($276)) + 72|0);
 $278 = HEAP32[11036]|0;
 $279 = ((($278)) + 16|0);
 $280 = HEAP32[11033]|0;
 $281 = ((($280)) + 96|0);
 $282 = ((($278)) + 56|0);
 $283 = ((($280)) + 104|0);
 $284 = ((($278)) + 80|0);
 $285 = ((($280)) + 120|0);
 $286 = HEAP32[11030]|0;
 $287 = ((($286)) + 80|0);
 $288 = HEAP32[11036]|0;
 $289 = ((($288)) + 24|0);
 $290 = HEAP32[11033]|0;
 $291 = ((($290)) + 96|0);
 $292 = ((($288)) + 48|0);
 $293 = ((($290)) + 104|0);
 $294 = ((($288)) + 88|0);
 $295 = ((($290)) + 120|0);
 $296 = HEAP32[11030]|0;
 $297 = ((($296)) + 80|0);
 $298 = HEAP32[11036]|0;
 $299 = ((($298)) + 40|0);
 $300 = HEAP32[11033]|0;
 $301 = ((($300)) + 96|0);
 $302 = ((($298)) + 64|0);
 $303 = ((($300)) + 104|0);
 $304 = ((($298)) + 88|0);
 $305 = ((($300)) + 112|0);
 $306 = HEAP32[11030]|0;
 $307 = ((($306)) + 88|0);
 $308 = HEAP32[11036]|0;
 $309 = ((($308)) + 32|0);
 $310 = HEAP32[11033]|0;
 $311 = ((($310)) + 96|0);
 $312 = ((($308)) + 72|0);
 $313 = ((($310)) + 104|0);
 $314 = ((($308)) + 80|0);
 $315 = ((($310)) + 112|0);
 $316 = HEAP32[11030]|0;
 $317 = ((($316)) + 88|0);
 $318 = HEAP32[11036]|0;
 $319 = ((($318)) + 16|0);
 $320 = HEAP32[11033]|0;
 $321 = ((($320)) + 80|0);
 $322 = ((($318)) + 40|0);
 $323 = ((($320)) + 88|0);
 $324 = ((($318)) + 8|0);
 $325 = ((($320)) + 72|0);
 $326 = HEAP32[11030]|0;
 $327 = ((($326)) + 96|0);
 $328 = HEAP32[11036]|0;
 $329 = ((($328)) + 32|0);
 $330 = HEAP32[11033]|0;
 $331 = ((($330)) + 88|0);
 $332 = ((($330)) + 72|0);
 $333 = ((($328)) + 24|0);
 $334 = ((($330)) + 80|0);
 $335 = HEAP32[11030]|0;
 $336 = ((($335)) + 96|0);
 $337 = HEAP32[11036]|0;
 $338 = ((($337)) + 64|0);
 $339 = HEAP32[11033]|0;
 $340 = ((($339)) + 88|0);
 $341 = ((($339)) + 64|0);
 $342 = ((($337)) + 56|0);
 $343 = ((($339)) + 80|0);
 $344 = HEAP32[11030]|0;
 $345 = ((($344)) + 104|0);
 $346 = HEAP32[11036]|0;
 $347 = ((($346)) + 48|0);
 $348 = HEAP32[11033]|0;
 $349 = ((($348)) + 80|0);
 $350 = ((($346)) + 72|0);
 $351 = ((($348)) + 88|0);
 $352 = ((($346)) + 8|0);
 $353 = ((($348)) + 64|0);
 $354 = HEAP32[11030]|0;
 $355 = ((($354)) + 104|0);
 $356 = HEAP32[11036]|0;
 $357 = ((($356)) + 48|0);
 $358 = HEAP32[11033]|0;
 $359 = ((($358)) + 72|0);
 $360 = ((($356)) + 88|0);
 $361 = ((($358)) + 88|0);
 $362 = ((($356)) + 24|0);
 $363 = ((($358)) + 64|0);
 $364 = HEAP32[11030]|0;
 $365 = ((($364)) + 112|0);
 $366 = HEAP32[11036]|0;
 $367 = ((($366)) + 80|0);
 $368 = HEAP32[11033]|0;
 $369 = ((($368)) + 88|0);
 $370 = ((($366)) + 16|0);
 $371 = ((($368)) + 64|0);
 $372 = ((($366)) + 56|0);
 $373 = ((($368)) + 72|0);
 $374 = HEAP32[11030]|0;
 $375 = ((($374)) + 112|0);
 $376 = HEAP32[11036]|0;
 $377 = ((($376)) + 80|0);
 $378 = HEAP32[11033]|0;
 $379 = ((($378)) + 80|0);
 $380 = ((($376)) + 32|0);
 $381 = ((($378)) + 64|0);
 $382 = ((($376)) + 72|0);
 $383 = ((($378)) + 72|0);
 $384 = HEAP32[11030]|0;
 $385 = ((($384)) + 120|0);
 $386 = HEAP32[11036]|0;
 $387 = ((($386)) + 64|0);
 $388 = HEAP32[11033]|0;
 $389 = ((($388)) + 72|0);
 $390 = ((($386)) + 88|0);
 $391 = ((($388)) + 80|0);
 $392 = ((($386)) + 40|0);
 $393 = ((($388)) + 64|0);
 $394 = HEAP32[11030]|0;
 $395 = ((($394)) + 120|0);
 $396 = HEAP32[11033]|0;
 $397 = ((($396)) + 8|0);
 $398 = ((($394)) + 8|0);
 $399 = ((($396)) + 16|0);
 $400 = ((($394)) + 16|0);
 $401 = ((($396)) + 24|0);
 $402 = ((($394)) + 24|0);
 $403 = HEAP32[11030]|0;
 $404 = 4024;
 $405 = $404;
 $406 = HEAP32[$405>>2]|0;
 $407 = (($404) + 4)|0;
 $408 = $407;
 $409 = HEAP32[$408>>2]|0;
 $410 = ((($5)) + 8|0);
 $411 = ((($6)) + 32|0);
 $412 = ((($5)) + 16|0);
 $413 = ((($6)) + 64|0);
 $414 = ((($5)) + 24|0);
 $415 = ((($6)) + 96|0);
 $416 = ((($5)) + 32|0);
 $417 = ((($6)) + 8|0);
 $418 = ((($5)) + 40|0);
 $419 = ((($6)) + 40|0);
 $420 = ((($5)) + 48|0);
 $421 = ((($6)) + 72|0);
 $422 = ((($5)) + 56|0);
 $423 = ((($6)) + 104|0);
 $424 = ((($5)) + 64|0);
 $425 = ((($6)) + 16|0);
 $426 = ((($5)) + 72|0);
 $427 = ((($6)) + 48|0);
 $428 = ((($5)) + 80|0);
 $429 = ((($6)) + 80|0);
 $430 = ((($5)) + 88|0);
 $431 = ((($6)) + 112|0);
 $432 = ((($5)) + 96|0);
 $433 = ((($6)) + 24|0);
 $434 = ((($5)) + 104|0);
 $435 = ((($6)) + 56|0);
 $436 = ((($5)) + 112|0);
 $437 = ((($6)) + 88|0);
 $438 = ((($5)) + 120|0);
 $439 = ((($6)) + 120|0);
 $440 = ((($403)) + 8|0);
 $441 = ((($403)) + 16|0);
 $442 = ((($403)) + 24|0);
 $443 = ((($403)) + 32|0);
 $444 = ((($403)) + 40|0);
 $445 = ((($403)) + 48|0);
 $446 = ((($403)) + 56|0);
 $447 = ((($403)) + 64|0);
 $448 = ((($403)) + 72|0);
 $449 = ((($403)) + 80|0);
 $450 = ((($403)) + 88|0);
 $451 = ((($403)) + 96|0);
 $452 = ((($403)) + 104|0);
 $453 = ((($403)) + 112|0);
 $454 = ((($403)) + 120|0);
 $986 = 0;$987 = 0;
 while(1) {
  $467 = +HEAPF64[$5>>3];
  HEAPF64[$6>>3] = $467;
  $468 = +HEAPF64[$410>>3];
  HEAPF64[$411>>3] = $468;
  $469 = +HEAPF64[$412>>3];
  HEAPF64[$413>>3] = $469;
  $470 = +HEAPF64[$414>>3];
  HEAPF64[$415>>3] = $470;
  $471 = +HEAPF64[$416>>3];
  HEAPF64[$417>>3] = $471;
  $472 = +HEAPF64[$418>>3];
  HEAPF64[$419>>3] = $472;
  $473 = +HEAPF64[$420>>3];
  HEAPF64[$421>>3] = $473;
  $474 = +HEAPF64[$422>>3];
  HEAPF64[$423>>3] = $474;
  $475 = +HEAPF64[$424>>3];
  HEAPF64[$425>>3] = $475;
  $476 = +HEAPF64[$426>>3];
  HEAPF64[$427>>3] = $476;
  $477 = +HEAPF64[$428>>3];
  HEAPF64[$429>>3] = $477;
  $478 = +HEAPF64[$430>>3];
  HEAPF64[$431>>3] = $478;
  $479 = +HEAPF64[$432>>3];
  HEAPF64[$433>>3] = $479;
  $480 = +HEAPF64[$434>>3];
  HEAPF64[$435>>3] = $480;
  $481 = +HEAPF64[$436>>3];
  HEAPF64[$437>>3] = $481;
  $482 = +HEAPF64[$438>>3];
  HEAPF64[$439>>3] = $482;
  $483 = +HEAPF64[$7>>3];
  $484 = $483 * $482;
  HEAPF64[$8>>3] = $484;
  $485 = +HEAPF64[$9>>3];
  $486 = +HEAPF64[$10>>3];
  $487 = $485 * $486;
  HEAPF64[$11>>3] = $487;
  $488 = +HEAPF64[$12>>3];
  $489 = +HEAPF64[$13>>3];
  $490 = $488 * $489;
  HEAPF64[$14>>3] = $490;
  $491 = +HEAPF64[$15>>3];
  $492 = +HEAPF64[$16>>3];
  $493 = $491 * $492;
  HEAPF64[$17>>3] = $493;
  $494 = +HEAPF64[$19>>3];
  $495 = +HEAPF64[$20>>3];
  $496 = $494 * $495;
  HEAPF64[$22>>3] = $496;
  $497 = +HEAPF64[$23>>3];
  $498 = +HEAPF64[$24>>3];
  $499 = $497 * $498;
  HEAPF64[$25>>3] = $499;
  $500 = +HEAPF64[$27>>3];
  $501 = +HEAPF64[$28>>3];
  $502 = $500 * $501;
  HEAPF64[$30>>3] = $502;
  $503 = +HEAPF64[$31>>3];
  $504 = +HEAPF64[$32>>3];
  $505 = $503 * $504;
  HEAPF64[$33>>3] = $505;
  $506 = +HEAPF64[$35>>3];
  $507 = +HEAPF64[$36>>3];
  $508 = $506 * $507;
  HEAPF64[$38>>3] = $508;
  $509 = +HEAPF64[$39>>3];
  $510 = +HEAPF64[$40>>3];
  $511 = $509 * $510;
  HEAPF64[$41>>3] = $511;
  $512 = +HEAPF64[$43>>3];
  $513 = +HEAPF64[$44>>3];
  $514 = $512 * $513;
  HEAPF64[$46>>3] = $514;
  $515 = +HEAPF64[$47>>3];
  $516 = +HEAPF64[$48>>3];
  $517 = $515 * $516;
  HEAPF64[$49>>3] = $517;
  $518 = +HEAPF64[$45>>3];
  $519 = +HEAPF64[$51>>3];
  $520 = $518 * $519;
  $521 = +HEAPF64[$52>>3];
  $522 = +HEAPF64[$53>>3];
  $523 = $521 * $522;
  $524 = $520 + $523;
  $525 = +HEAPF64[$54>>3];
  $526 = +HEAPF64[$55>>3];
  $527 = $525 * $526;
  $528 = $524 + $527;
  HEAPF64[$56>>3] = $528;
  $529 = +HEAPF64[$58>>3];
  $530 = +HEAPF64[$60>>3];
  $531 = $529 * $530;
  $532 = +HEAPF64[$61>>3];
  $533 = +HEAPF64[$62>>3];
  $534 = $532 * $533;
  $535 = $531 + $534;
  $536 = +HEAPF64[$63>>3];
  $537 = +HEAPF64[$64>>3];
  $538 = $536 * $537;
  $539 = $535 + $538;
  $540 = +HEAPF64[$65>>3];
  $541 = $540 - $539;
  HEAPF64[$65>>3] = $541;
  $542 = +HEAPF64[$67>>3];
  $543 = +HEAPF64[$69>>3];
  $544 = $542 * $543;
  $545 = +HEAPF64[$70>>3];
  $546 = +HEAPF64[$71>>3];
  $547 = $545 * $546;
  $548 = $544 + $547;
  $549 = +HEAPF64[$72>>3];
  $550 = +HEAPF64[$73>>3];
  $551 = $549 * $550;
  $552 = $548 + $551;
  HEAPF64[$75>>3] = $552;
  $553 = +HEAPF64[$76>>3];
  $554 = +HEAPF64[$78>>3];
  $555 = $553 * $554;
  $556 = +HEAPF64[$79>>3];
  $557 = +HEAPF64[$80>>3];
  $558 = $556 * $557;
  $559 = $555 + $558;
  $560 = +HEAPF64[$81>>3];
  $561 = +HEAPF64[$82>>3];
  $562 = $560 * $561;
  $563 = $559 + $562;
  $564 = +HEAPF64[$84>>3];
  $565 = $564 - $563;
  HEAPF64[$84>>3] = $565;
  $566 = +HEAPF64[$86>>3];
  $567 = +HEAPF64[$88>>3];
  $568 = $566 * $567;
  $569 = +HEAPF64[$89>>3];
  $570 = +HEAPF64[$90>>3];
  $571 = $569 * $570;
  $572 = $568 + $571;
  $573 = +HEAPF64[$91>>3];
  $574 = +HEAPF64[$92>>3];
  $575 = $573 * $574;
  $576 = $572 + $575;
  HEAPF64[$94>>3] = $576;
  $577 = +HEAPF64[$96>>3];
  $578 = +HEAPF64[$98>>3];
  $579 = $577 * $578;
  $580 = +HEAPF64[$99>>3];
  $581 = +HEAPF64[$100>>3];
  $582 = $580 * $581;
  $583 = $579 + $582;
  $584 = +HEAPF64[$101>>3];
  $585 = +HEAPF64[$102>>3];
  $586 = $584 * $585;
  $587 = $583 + $586;
  $588 = +HEAPF64[$104>>3];
  $589 = $588 - $587;
  HEAPF64[$104>>3] = $589;
  $590 = +HEAPF64[$106>>3];
  $591 = +HEAPF64[$108>>3];
  $592 = $590 * $591;
  $593 = +HEAPF64[$109>>3];
  $594 = +HEAPF64[$110>>3];
  $595 = $593 * $594;
  $596 = $592 + $595;
  $597 = +HEAPF64[$111>>3];
  $598 = +HEAPF64[$112>>3];
  $599 = $597 * $598;
  $600 = $596 + $599;
  HEAPF64[$114>>3] = $600;
  $601 = +HEAPF64[$116>>3];
  $602 = +HEAPF64[$118>>3];
  $603 = $601 * $602;
  $604 = +HEAPF64[$119>>3];
  $605 = +HEAPF64[$120>>3];
  $606 = $604 * $605;
  $607 = $603 + $606;
  $608 = +HEAPF64[$121>>3];
  $609 = +HEAPF64[$122>>3];
  $610 = $608 * $609;
  $611 = $607 + $610;
  $612 = +HEAPF64[$124>>3];
  $613 = $612 - $611;
  HEAPF64[$124>>3] = $613;
  $614 = +HEAPF64[$126>>3];
  $615 = +HEAPF64[$128>>3];
  $616 = $614 * $615;
  $617 = +HEAPF64[$129>>3];
  $618 = +HEAPF64[$130>>3];
  $619 = $617 * $618;
  $620 = $616 + $619;
  $621 = +HEAPF64[$131>>3];
  $622 = +HEAPF64[$132>>3];
  $623 = $621 * $622;
  $624 = $620 + $623;
  HEAPF64[$134>>3] = $624;
  $625 = +HEAPF64[$135>>3];
  $626 = +HEAPF64[$137>>3];
  $627 = $625 * $626;
  $628 = +HEAPF64[$138>>3];
  $629 = +HEAPF64[$139>>3];
  $630 = $628 * $629;
  $631 = $627 + $630;
  $632 = +HEAPF64[$140>>3];
  $633 = +HEAPF64[$141>>3];
  $634 = $632 * $633;
  $635 = $631 + $634;
  $636 = +HEAPF64[$143>>3];
  $637 = $636 - $635;
  HEAPF64[$143>>3] = $637;
  $638 = +HEAPF64[$144>>3];
  $639 = +HEAPF64[$145>>3];
  $640 = $638 * $639;
  $641 = +HEAPF64[$146>>3];
  $642 = +HEAPF64[$147>>3];
  $643 = $641 * $642;
  $644 = $640 + $643;
  $645 = +HEAPF64[$148>>3];
  $646 = +HEAPF64[$149>>3];
  $647 = $645 * $646;
  $648 = $644 + $647;
  HEAPF64[$151>>3] = $648;
  $649 = +HEAPF64[$153>>3];
  $650 = +HEAPF64[$154>>3];
  $651 = $649 * $650;
  $652 = +HEAPF64[$155>>3];
  $653 = +HEAPF64[$156>>3];
  $654 = $652 * $653;
  $655 = $651 + $654;
  $656 = +HEAPF64[$157>>3];
  $657 = +HEAPF64[$158>>3];
  $658 = $656 * $657;
  $659 = $655 + $658;
  $660 = +HEAPF64[$160>>3];
  $661 = $660 - $659;
  HEAPF64[$160>>3] = $661;
  $662 = +HEAPF64[$162>>3];
  $663 = +HEAPF64[$163>>3];
  $664 = $662 * $663;
  $665 = +HEAPF64[$164>>3];
  $666 = +HEAPF64[$165>>3];
  $667 = $665 * $666;
  $668 = $664 + $667;
  $669 = +HEAPF64[$166>>3];
  $670 = +HEAPF64[$167>>3];
  $671 = $669 * $670;
  $672 = $668 + $671;
  HEAPF64[$169>>3] = $672;
  $673 = +HEAPF64[$171>>3];
  $674 = +HEAPF64[$172>>3];
  $675 = $673 * $674;
  $676 = +HEAPF64[$173>>3];
  $677 = +HEAPF64[$174>>3];
  $678 = $676 * $677;
  $679 = $675 + $678;
  $680 = +HEAPF64[$175>>3];
  $681 = +HEAPF64[$176>>3];
  $682 = $680 * $681;
  $683 = $679 + $682;
  $684 = +HEAPF64[$178>>3];
  $685 = $684 - $683;
  HEAPF64[$178>>3] = $685;
  $686 = +HEAPF64[$180>>3];
  $687 = +HEAPF64[$181>>3];
  $688 = $686 * $687;
  $689 = +HEAPF64[$182>>3];
  $690 = +HEAPF64[$183>>3];
  $691 = $689 * $690;
  $692 = $688 + $691;
  $693 = +HEAPF64[$184>>3];
  $694 = +HEAPF64[$185>>3];
  $695 = $693 * $694;
  $696 = $692 + $695;
  HEAPF64[$187>>3] = $696;
  $697 = +HEAPF64[$189>>3];
  $698 = +HEAPF64[$190>>3];
  $699 = $697 * $698;
  $700 = +HEAPF64[$191>>3];
  $701 = +HEAPF64[$192>>3];
  $702 = $700 * $701;
  $703 = $699 + $702;
  $704 = +HEAPF64[$193>>3];
  $705 = +HEAPF64[$194>>3];
  $706 = $704 * $705;
  $707 = $703 + $706;
  $708 = +HEAPF64[$196>>3];
  $709 = $708 - $707;
  HEAPF64[$196>>3] = $709;
  $710 = +HEAPF64[$198>>3];
  $711 = +HEAPF64[$199>>3];
  $712 = $710 * $711;
  HEAPF64[$200>>3] = $712;
  $713 = +HEAPF64[$201>>3];
  $714 = +HEAPF64[$202>>3];
  $715 = $713 * $714;
  HEAPF64[$203>>3] = $715;
  $716 = +HEAPF64[$205>>3];
  $717 = +HEAPF64[$206>>3];
  $718 = $716 * $717;
  HEAPF64[$208>>3] = $718;
  $719 = +HEAPF64[$209>>3];
  $720 = +HEAPF64[$210>>3];
  $721 = $719 * $720;
  HEAPF64[$211>>3] = $721;
  $722 = +HEAPF64[$213>>3];
  $723 = +HEAPF64[$214>>3];
  $724 = $722 * $723;
  HEAPF64[$216>>3] = $724;
  $725 = +HEAPF64[$217>>3];
  $726 = +HEAPF64[$218>>3];
  $727 = $725 * $726;
  HEAPF64[$219>>3] = $727;
  $728 = +HEAPF64[$220>>3];
  $729 = +HEAPF64[$221>>3];
  $730 = $728 * $729;
  HEAPF64[$223>>3] = $730;
  $731 = +HEAPF64[$224>>3];
  $732 = +HEAPF64[$225>>3];
  $733 = $731 * $732;
  HEAPF64[$226>>3] = $733;
  $734 = +HEAPF64[$227>>3];
  $735 = +HEAPF64[$228>>3];
  $736 = $734 * $735;
  HEAPF64[$230>>3] = $736;
  $737 = +HEAPF64[$231>>3];
  $738 = +HEAPF64[$232>>3];
  $739 = $737 * $738;
  HEAPF64[$233>>3] = $739;
  $740 = +HEAPF64[$234>>3];
  $741 = +HEAPF64[$235>>3];
  $742 = $740 * $741;
  HEAPF64[$237>>3] = $742;
  $743 = +HEAPF64[$238>>3];
  $744 = +HEAPF64[$239>>3];
  $745 = $743 * $744;
  HEAPF64[$240>>3] = $745;
  $746 = +HEAPF64[$236>>3];
  $747 = +HEAPF64[$242>>3];
  $748 = $746 * $747;
  $749 = +HEAPF64[$243>>3];
  $750 = +HEAPF64[$244>>3];
  $751 = $749 * $750;
  $752 = $748 + $751;
  $753 = +HEAPF64[$245>>3];
  $754 = +HEAPF64[$246>>3];
  $755 = $753 * $754;
  $756 = $752 + $755;
  HEAPF64[$248>>3] = $756;
  $757 = +HEAPF64[$250>>3];
  $758 = +HEAPF64[$252>>3];
  $759 = $757 * $758;
  $760 = +HEAPF64[$253>>3];
  $761 = +HEAPF64[$254>>3];
  $762 = $760 * $761;
  $763 = $759 + $762;
  $764 = +HEAPF64[$255>>3];
  $765 = +HEAPF64[$256>>3];
  $766 = $764 * $765;
  $767 = $763 + $766;
  $768 = +HEAPF64[$258>>3];
  $769 = $768 - $767;
  HEAPF64[$258>>3] = $769;
  $770 = +HEAPF64[$260>>3];
  $771 = +HEAPF64[$262>>3];
  $772 = $770 * $771;
  $773 = +HEAPF64[$263>>3];
  $774 = +HEAPF64[$264>>3];
  $775 = $773 * $774;
  $776 = $772 + $775;
  $777 = +HEAPF64[$265>>3];
  $778 = +HEAPF64[$266>>3];
  $779 = $777 * $778;
  $780 = $776 + $779;
  HEAPF64[$268>>3] = $780;
  $781 = +HEAPF64[$269>>3];
  $782 = +HEAPF64[$271>>3];
  $783 = $781 * $782;
  $784 = +HEAPF64[$272>>3];
  $785 = +HEAPF64[$273>>3];
  $786 = $784 * $785;
  $787 = $783 + $786;
  $788 = +HEAPF64[$274>>3];
  $789 = +HEAPF64[$275>>3];
  $790 = $788 * $789;
  $791 = $787 + $790;
  $792 = +HEAPF64[$277>>3];
  $793 = $792 - $791;
  HEAPF64[$277>>3] = $793;
  $794 = +HEAPF64[$279>>3];
  $795 = +HEAPF64[$281>>3];
  $796 = $794 * $795;
  $797 = +HEAPF64[$282>>3];
  $798 = +HEAPF64[$283>>3];
  $799 = $797 * $798;
  $800 = $796 + $799;
  $801 = +HEAPF64[$284>>3];
  $802 = +HEAPF64[$285>>3];
  $803 = $801 * $802;
  $804 = $800 + $803;
  HEAPF64[$287>>3] = $804;
  $805 = +HEAPF64[$289>>3];
  $806 = +HEAPF64[$291>>3];
  $807 = $805 * $806;
  $808 = +HEAPF64[$292>>3];
  $809 = +HEAPF64[$293>>3];
  $810 = $808 * $809;
  $811 = $807 + $810;
  $812 = +HEAPF64[$294>>3];
  $813 = +HEAPF64[$295>>3];
  $814 = $812 * $813;
  $815 = $811 + $814;
  $816 = +HEAPF64[$297>>3];
  $817 = $816 - $815;
  HEAPF64[$297>>3] = $817;
  $818 = +HEAPF64[$299>>3];
  $819 = +HEAPF64[$301>>3];
  $820 = $818 * $819;
  $821 = +HEAPF64[$302>>3];
  $822 = +HEAPF64[$303>>3];
  $823 = $821 * $822;
  $824 = $820 + $823;
  $825 = +HEAPF64[$304>>3];
  $826 = +HEAPF64[$305>>3];
  $827 = $825 * $826;
  $828 = $824 + $827;
  HEAPF64[$307>>3] = $828;
  $829 = +HEAPF64[$309>>3];
  $830 = +HEAPF64[$311>>3];
  $831 = $829 * $830;
  $832 = +HEAPF64[$312>>3];
  $833 = +HEAPF64[$313>>3];
  $834 = $832 * $833;
  $835 = $831 + $834;
  $836 = +HEAPF64[$314>>3];
  $837 = +HEAPF64[$315>>3];
  $838 = $836 * $837;
  $839 = $835 + $838;
  $840 = +HEAPF64[$317>>3];
  $841 = $840 - $839;
  HEAPF64[$317>>3] = $841;
  $842 = +HEAPF64[$319>>3];
  $843 = +HEAPF64[$321>>3];
  $844 = $842 * $843;
  $845 = +HEAPF64[$322>>3];
  $846 = +HEAPF64[$323>>3];
  $847 = $845 * $846;
  $848 = $844 + $847;
  $849 = +HEAPF64[$324>>3];
  $850 = +HEAPF64[$325>>3];
  $851 = $849 * $850;
  $852 = $848 + $851;
  HEAPF64[$327>>3] = $852;
  $853 = +HEAPF64[$329>>3];
  $854 = +HEAPF64[$331>>3];
  $855 = $853 * $854;
  $856 = +HEAPF64[$328>>3];
  $857 = +HEAPF64[$332>>3];
  $858 = $856 * $857;
  $859 = $855 + $858;
  $860 = +HEAPF64[$333>>3];
  $861 = +HEAPF64[$334>>3];
  $862 = $860 * $861;
  $863 = $859 + $862;
  $864 = +HEAPF64[$336>>3];
  $865 = $864 - $863;
  HEAPF64[$336>>3] = $865;
  $866 = +HEAPF64[$338>>3];
  $867 = +HEAPF64[$340>>3];
  $868 = $866 * $867;
  $869 = +HEAPF64[$337>>3];
  $870 = +HEAPF64[$341>>3];
  $871 = $869 * $870;
  $872 = $868 + $871;
  $873 = +HEAPF64[$342>>3];
  $874 = +HEAPF64[$343>>3];
  $875 = $873 * $874;
  $876 = $872 + $875;
  HEAPF64[$345>>3] = $876;
  $877 = +HEAPF64[$347>>3];
  $878 = +HEAPF64[$349>>3];
  $879 = $877 * $878;
  $880 = +HEAPF64[$350>>3];
  $881 = +HEAPF64[$351>>3];
  $882 = $880 * $881;
  $883 = $879 + $882;
  $884 = +HEAPF64[$352>>3];
  $885 = +HEAPF64[$353>>3];
  $886 = $884 * $885;
  $887 = $883 + $886;
  $888 = +HEAPF64[$355>>3];
  $889 = $888 - $887;
  HEAPF64[$355>>3] = $889;
  $890 = +HEAPF64[$357>>3];
  $891 = +HEAPF64[$359>>3];
  $892 = $890 * $891;
  $893 = +HEAPF64[$360>>3];
  $894 = +HEAPF64[$361>>3];
  $895 = $893 * $894;
  $896 = $892 + $895;
  $897 = +HEAPF64[$362>>3];
  $898 = +HEAPF64[$363>>3];
  $899 = $897 * $898;
  $900 = $896 + $899;
  HEAPF64[$365>>3] = $900;
  $901 = +HEAPF64[$367>>3];
  $902 = +HEAPF64[$369>>3];
  $903 = $901 * $902;
  $904 = +HEAPF64[$370>>3];
  $905 = +HEAPF64[$371>>3];
  $906 = $904 * $905;
  $907 = $903 + $906;
  $908 = +HEAPF64[$372>>3];
  $909 = +HEAPF64[$373>>3];
  $910 = $908 * $909;
  $911 = $907 + $910;
  $912 = +HEAPF64[$375>>3];
  $913 = $912 - $911;
  HEAPF64[$375>>3] = $913;
  $914 = +HEAPF64[$377>>3];
  $915 = +HEAPF64[$379>>3];
  $916 = $914 * $915;
  $917 = +HEAPF64[$380>>3];
  $918 = +HEAPF64[$381>>3];
  $919 = $917 * $918;
  $920 = $916 + $919;
  $921 = +HEAPF64[$382>>3];
  $922 = +HEAPF64[$383>>3];
  $923 = $921 * $922;
  $924 = $920 + $923;
  HEAPF64[$385>>3] = $924;
  $925 = +HEAPF64[$387>>3];
  $926 = +HEAPF64[$389>>3];
  $927 = $925 * $926;
  $928 = +HEAPF64[$390>>3];
  $929 = +HEAPF64[$391>>3];
  $930 = $928 * $929;
  $931 = $927 + $930;
  $932 = +HEAPF64[$392>>3];
  $933 = +HEAPF64[$393>>3];
  $934 = $932 * $933;
  $935 = $931 + $934;
  $936 = +HEAPF64[$395>>3];
  $937 = $936 - $935;
  HEAPF64[$395>>3] = $937;
  $938 = +HEAPF64[$396>>3];
  $939 = +HEAPF64[$394>>3];
  $940 = $938 * $939;
  $941 = +HEAPF64[$397>>3];
  $942 = +HEAPF64[$398>>3];
  $943 = $941 * $942;
  $944 = $940 + $943;
  $945 = +HEAPF64[$399>>3];
  $946 = +HEAPF64[$400>>3];
  $947 = $945 * $946;
  $948 = $944 + $947;
  $949 = +HEAPF64[$401>>3];
  $950 = +HEAPF64[$402>>3];
  $951 = $949 * $950;
  $952 = $948 + $951;
  $953 = 1.0 / $952;
  $954 = +HEAPF64[$403>>3];
  $955 = $953 * $954;
  HEAPF64[$403>>3] = $955;
  $956 = +HEAPF64[$440>>3];
  $957 = $953 * $956;
  HEAPF64[$440>>3] = $957;
  $958 = +HEAPF64[$441>>3];
  $959 = $953 * $958;
  HEAPF64[$441>>3] = $959;
  $960 = +HEAPF64[$442>>3];
  $961 = $953 * $960;
  HEAPF64[$442>>3] = $961;
  $962 = +HEAPF64[$443>>3];
  $963 = $953 * $962;
  HEAPF64[$443>>3] = $963;
  $964 = +HEAPF64[$444>>3];
  $965 = $953 * $964;
  HEAPF64[$444>>3] = $965;
  $966 = +HEAPF64[$445>>3];
  $967 = $953 * $966;
  HEAPF64[$445>>3] = $967;
  $968 = +HEAPF64[$446>>3];
  $969 = $953 * $968;
  HEAPF64[$446>>3] = $969;
  $970 = +HEAPF64[$447>>3];
  $971 = $953 * $970;
  HEAPF64[$447>>3] = $971;
  $972 = +HEAPF64[$448>>3];
  $973 = $953 * $972;
  HEAPF64[$448>>3] = $973;
  $974 = +HEAPF64[$449>>3];
  $975 = $953 * $974;
  HEAPF64[$449>>3] = $975;
  $976 = +HEAPF64[$450>>3];
  $977 = $953 * $976;
  HEAPF64[$450>>3] = $977;
  $978 = +HEAPF64[$451>>3];
  $979 = $953 * $978;
  HEAPF64[$451>>3] = $979;
  $980 = +HEAPF64[$452>>3];
  $981 = $953 * $980;
  HEAPF64[$452>>3] = $981;
  $982 = +HEAPF64[$453>>3];
  $983 = $953 * $982;
  HEAPF64[$453>>3] = $983;
  $984 = +HEAPF64[$454>>3];
  $985 = $953 * $984;
  HEAPF64[$454>>3] = $985;
  $988 = (_i64Add(($986|0),($987|0),1,0)|0);
  $989 = tempRet0;
  $990 = ($989>>>0)<($1>>>0);
  $991 = ($988>>>0)<($0>>>0);
  $992 = ($989|0)==($1|0);
  $993 = $992 & $991;
  $994 = $990 | $993;
  if ($994) {
   $986 = $988;$987 = $989;
  } else {
   break;
  }
 }
 $455 = (_i64Add(($406|0),($409|0),($0|0),($1|0))|0);
 $456 = tempRet0;
 $457 = 4024;
 $458 = $457;
 HEAP32[$458>>2] = $455;
 $459 = (($457) + 4)|0;
 $460 = $459;
 HEAP32[$460>>2] = $456;
 $461 = 4024;
 $462 = $461;
 $463 = HEAP32[$462>>2]|0;
 $464 = (($461) + 4)|0;
 $465 = $464;
 $466 = HEAP32[$465>>2]|0;
 tempRet0 = ($466);
 return ($463|0);
}
function __ZN13MatrixInverse10initMatrixEPf($matrix) {
 $matrix = $matrix|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAPF32[$matrix>>2] = 0.0;
 $0 = ((($matrix)) + 4|0);
 HEAPF32[$0>>2] = 1.0;
 $1 = ((($matrix)) + 8|0);
 HEAPF32[$1>>2] = 2.0;
 $2 = ((($matrix)) + 12|0);
 HEAPF32[$2>>2] = 3.0;
 $3 = ((($matrix)) + 16|0);
 HEAPF32[$3>>2] = -1.0;
 $4 = ((($matrix)) + 20|0);
 HEAPF32[$4>>2] = -2.0;
 $5 = ((($matrix)) + 24|0);
 HEAPF32[$5>>2] = -3.0;
 $6 = ((($matrix)) + 28|0);
 HEAPF32[$6>>2] = -4.0;
 $7 = ((($matrix)) + 32|0);
 HEAPF32[$7>>2] = 0.0;
 $8 = ((($matrix)) + 36|0);
 HEAPF32[$8>>2] = 0.0;
 $9 = ((($matrix)) + 40|0);
 HEAPF32[$9>>2] = 2.0;
 $10 = ((($matrix)) + 44|0);
 HEAPF32[$10>>2] = 3.0;
 $11 = ((($matrix)) + 48|0);
 HEAPF32[$11>>2] = -1.0;
 $12 = ((($matrix)) + 52|0);
 HEAPF32[$12>>2] = -2.0;
 $13 = ((($matrix)) + 56|0);
 HEAPF32[$13>>2] = 0.0;
 $14 = ((($matrix)) + 60|0);
 HEAPF32[$14>>2] = -4.0;
 return;
}
function __ZN13MatrixInverse11checkMatrixEPf($matrix) {
 $matrix = $matrix|0;
 var $0 = 0, $1 = 0, $10 = 0.0, $11 = 0.0, $12 = 0, $13 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0.0, $8 = 0, $9 = 0.0, $fabsf = 0.0, $i$02 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[11032]|0;
 $1 = HEAP32[11026]|0;
 __ZN13MatrixInverse9mulMatrixEPfPKfS2_($0,$1,$matrix);
 $2 = HEAP32[11032]|0;
 $3 = HEAP32[11037]|0;
 $i$02 = 0;
 while(1) {
  $6 = (($2) + ($i$02<<2)|0);
  $7 = +HEAPF32[$6>>2];
  $8 = (($3) + ($i$02<<2)|0);
  $9 = +HEAPF32[$8>>2];
  $10 = $7 - $9;
  $fabsf = (+Math_abs((+$10)));
  $11 = $fabsf;
  $12 = $11 > 1.0000000000000001E-5;
  $5 = (($i$02) + 1)|0;
  if ($12) {
   $13 = 0;
   label = 4;
   break;
  }
  $4 = ($5|0)<(16);
  if ($4) {
   $i$02 = $5;
  } else {
   $13 = 1;
   label = 4;
   break;
  }
 }
 if ((label|0) == 4) {
  return ($13|0);
 }
 return (0)|0;
}
function __ZN13MatrixInverse12initMatrix64EPd($matrix) {
 $matrix = $matrix|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAPF64[$matrix>>3] = 0.0;
 $0 = ((($matrix)) + 8|0);
 HEAPF64[$0>>3] = 1.0;
 $1 = ((($matrix)) + 16|0);
 HEAPF64[$1>>3] = 2.0;
 $2 = ((($matrix)) + 24|0);
 HEAPF64[$2>>3] = 3.0;
 $3 = ((($matrix)) + 32|0);
 HEAPF64[$3>>3] = -1.0;
 $4 = ((($matrix)) + 40|0);
 HEAPF64[$4>>3] = -2.0;
 $5 = ((($matrix)) + 48|0);
 HEAPF64[$5>>3] = -3.0;
 $6 = ((($matrix)) + 56|0);
 HEAPF64[$6>>3] = -4.0;
 $7 = ((($matrix)) + 64|0);
 $8 = ((($matrix)) + 80|0);
 ;HEAP32[$7>>2]=0|0;HEAP32[$7+4>>2]=0|0;HEAP32[$7+8>>2]=0|0;HEAP32[$7+12>>2]=0|0;
 HEAPF64[$8>>3] = 2.0;
 $9 = ((($matrix)) + 88|0);
 HEAPF64[$9>>3] = 3.0;
 $10 = ((($matrix)) + 96|0);
 HEAPF64[$10>>3] = -1.0;
 $11 = ((($matrix)) + 104|0);
 HEAPF64[$11>>3] = -2.0;
 $12 = ((($matrix)) + 112|0);
 HEAPF64[$12>>3] = 0.0;
 $13 = ((($matrix)) + 120|0);
 HEAPF64[$13>>3] = -4.0;
 return;
}
function __ZN13MatrixInverse13checkMatrix64EPd($matrix) {
 $matrix = $matrix|0;
 var $0 = 0, $1 = 0, $10 = 0.0, $11 = 0.0, $12 = 0, $13 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0.0, $8 = 0, $9 = 0.0, $fabsf = 0.0, $i$02 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[11033]|0;
 $1 = HEAP32[11027]|0;
 __ZN13MatrixInverse11mulMatrix64EPdPKdS2_($0,$1,$matrix);
 $2 = HEAP32[11032]|0;
 $3 = HEAP32[11037]|0;
 $i$02 = 0;
 while(1) {
  $6 = (($2) + ($i$02<<2)|0);
  $7 = +HEAPF32[$6>>2];
  $8 = (($3) + ($i$02<<2)|0);
  $9 = +HEAPF32[$8>>2];
  $10 = $7 - $9;
  $fabsf = (+Math_abs((+$10)));
  $11 = $fabsf;
  $12 = $11 > 1.0000000000000001E-5;
  $5 = (($i$02) + 1)|0;
  if ($12) {
   $13 = 0;
   label = 4;
   break;
  }
  $4 = ($5|0)<(16);
  if ($4) {
   $i$02 = $5;
  } else {
   $13 = 1;
   label = 4;
   break;
  }
 }
 if ((label|0) == 4) {
  return ($13|0);
 }
 return (0)|0;
}
function __ZN13MatrixInverse9mulMatrixEPfPKfS2_($dst,$op1,$op2) {
 $dst = $dst|0;
 $op1 = $op1|0;
 $op2 = $op2|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0.0, $24 = 0.0, $25 = 0.0, $26 = 0.0;
 var $27 = 0.0, $28 = 0.0, $29 = 0.0, $3 = 0, $30 = 0.0, $31 = 0.0, $32 = 0.0, $33 = 0.0, $34 = 0.0, $35 = 0.0, $36 = 0.0, $37 = 0.0, $38 = 0, $39 = 0.0, $4 = 0, $40 = 0.0, $41 = 0.0, $42 = 0.0, $43 = 0.0, $44 = 0.0;
 var $45 = 0.0, $46 = 0.0, $47 = 0.0, $48 = 0.0, $49 = 0.0, $5 = 0, $50 = 0.0, $51 = 0.0, $52 = 0.0, $53 = 0.0, $54 = 0, $55 = 0, $56 = 0.0, $57 = 0.0, $58 = 0.0, $59 = 0.0, $6 = 0, $60 = 0.0, $61 = 0.0, $62 = 0.0;
 var $63 = 0.0, $64 = 0.0, $65 = 0.0, $66 = 0.0, $67 = 0.0, $68 = 0.0, $69 = 0.0, $7 = 0, $70 = 0.0, $71 = 0, $72 = 0, $73 = 0.0, $74 = 0.0, $75 = 0.0, $76 = 0.0, $77 = 0.0, $78 = 0.0, $79 = 0.0, $8 = 0, $80 = 0.0;
 var $81 = 0.0, $82 = 0.0, $83 = 0.0, $84 = 0.0, $85 = 0.0, $86 = 0.0, $87 = 0.0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $exitcond3 = 0, $r$02 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($op2)) + 16|0);
 $1 = ((($op2)) + 32|0);
 $2 = ((($op2)) + 48|0);
 $3 = ((($op2)) + 4|0);
 $4 = ((($op2)) + 20|0);
 $5 = ((($op2)) + 36|0);
 $6 = ((($op2)) + 52|0);
 $7 = ((($op2)) + 8|0);
 $8 = ((($op2)) + 24|0);
 $9 = ((($op2)) + 40|0);
 $10 = ((($op2)) + 56|0);
 $11 = ((($op2)) + 12|0);
 $12 = ((($op2)) + 28|0);
 $13 = ((($op2)) + 44|0);
 $14 = ((($op2)) + 60|0);
 $r$02 = 0;
 while(1) {
  $15 = $r$02 << 2;
  $16 = (($op1) + ($15<<2)|0);
  $17 = $15 | 1;
  $18 = (($op1) + ($17<<2)|0);
  $19 = $15 | 2;
  $20 = (($op1) + ($19<<2)|0);
  $21 = $15 | 3;
  $22 = (($op1) + ($21<<2)|0);
  $23 = +HEAPF32[$16>>2];
  $24 = +HEAPF32[$op2>>2];
  $25 = $23 * $24;
  $26 = +HEAPF32[$18>>2];
  $27 = +HEAPF32[$0>>2];
  $28 = $26 * $27;
  $29 = $25 + $28;
  $30 = +HEAPF32[$20>>2];
  $31 = +HEAPF32[$1>>2];
  $32 = $30 * $31;
  $33 = $29 + $32;
  $34 = +HEAPF32[$22>>2];
  $35 = +HEAPF32[$2>>2];
  $36 = $34 * $35;
  $37 = $33 + $36;
  $38 = (($dst) + ($15<<2)|0);
  HEAPF32[$38>>2] = $37;
  $39 = +HEAPF32[$16>>2];
  $40 = +HEAPF32[$3>>2];
  $41 = $39 * $40;
  $42 = +HEAPF32[$18>>2];
  $43 = +HEAPF32[$4>>2];
  $44 = $42 * $43;
  $45 = $41 + $44;
  $46 = +HEAPF32[$20>>2];
  $47 = +HEAPF32[$5>>2];
  $48 = $46 * $47;
  $49 = $45 + $48;
  $50 = +HEAPF32[$22>>2];
  $51 = +HEAPF32[$6>>2];
  $52 = $50 * $51;
  $53 = $49 + $52;
  $54 = $15 | 1;
  $55 = (($dst) + ($54<<2)|0);
  HEAPF32[$55>>2] = $53;
  $56 = +HEAPF32[$16>>2];
  $57 = +HEAPF32[$7>>2];
  $58 = $56 * $57;
  $59 = +HEAPF32[$18>>2];
  $60 = +HEAPF32[$8>>2];
  $61 = $59 * $60;
  $62 = $58 + $61;
  $63 = +HEAPF32[$20>>2];
  $64 = +HEAPF32[$9>>2];
  $65 = $63 * $64;
  $66 = $62 + $65;
  $67 = +HEAPF32[$22>>2];
  $68 = +HEAPF32[$10>>2];
  $69 = $67 * $68;
  $70 = $66 + $69;
  $71 = $15 | 2;
  $72 = (($dst) + ($71<<2)|0);
  HEAPF32[$72>>2] = $70;
  $73 = +HEAPF32[$16>>2];
  $74 = +HEAPF32[$11>>2];
  $75 = $73 * $74;
  $76 = +HEAPF32[$18>>2];
  $77 = +HEAPF32[$12>>2];
  $78 = $76 * $77;
  $79 = $75 + $78;
  $80 = +HEAPF32[$20>>2];
  $81 = +HEAPF32[$13>>2];
  $82 = $80 * $81;
  $83 = $79 + $82;
  $84 = +HEAPF32[$22>>2];
  $85 = +HEAPF32[$14>>2];
  $86 = $84 * $85;
  $87 = $83 + $86;
  $88 = $15 | 3;
  $89 = (($dst) + ($88<<2)|0);
  HEAPF32[$89>>2] = $87;
  $90 = (($r$02) + 1)|0;
  $exitcond3 = ($90|0)==(4);
  if ($exitcond3) {
   break;
  } else {
   $r$02 = $90;
  }
 }
 return;
}
function __ZN13MatrixInverse11mulMatrix64EPdPKdS2_($dst,$op1,$op2) {
 $dst = $dst|0;
 $op1 = $op1|0;
 $op2 = $op2|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0.0, $24 = 0.0, $25 = 0.0, $26 = 0.0;
 var $27 = 0.0, $28 = 0.0, $29 = 0.0, $3 = 0, $30 = 0.0, $31 = 0.0, $32 = 0.0, $33 = 0.0, $34 = 0.0, $35 = 0.0, $36 = 0.0, $37 = 0.0, $38 = 0, $39 = 0.0, $4 = 0, $40 = 0.0, $41 = 0.0, $42 = 0.0, $43 = 0.0, $44 = 0.0;
 var $45 = 0.0, $46 = 0.0, $47 = 0.0, $48 = 0.0, $49 = 0.0, $5 = 0, $50 = 0.0, $51 = 0.0, $52 = 0.0, $53 = 0.0, $54 = 0, $55 = 0, $56 = 0.0, $57 = 0.0, $58 = 0.0, $59 = 0.0, $6 = 0, $60 = 0.0, $61 = 0.0, $62 = 0.0;
 var $63 = 0.0, $64 = 0.0, $65 = 0.0, $66 = 0.0, $67 = 0.0, $68 = 0.0, $69 = 0.0, $7 = 0, $70 = 0.0, $71 = 0, $72 = 0, $73 = 0.0, $74 = 0.0, $75 = 0.0, $76 = 0.0, $77 = 0.0, $78 = 0.0, $79 = 0.0, $8 = 0, $80 = 0.0;
 var $81 = 0.0, $82 = 0.0, $83 = 0.0, $84 = 0.0, $85 = 0.0, $86 = 0.0, $87 = 0.0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $exitcond3 = 0, $r$02 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($op2)) + 32|0);
 $1 = ((($op2)) + 64|0);
 $2 = ((($op2)) + 96|0);
 $3 = ((($op2)) + 8|0);
 $4 = ((($op2)) + 40|0);
 $5 = ((($op2)) + 72|0);
 $6 = ((($op2)) + 104|0);
 $7 = ((($op2)) + 16|0);
 $8 = ((($op2)) + 48|0);
 $9 = ((($op2)) + 80|0);
 $10 = ((($op2)) + 112|0);
 $11 = ((($op2)) + 24|0);
 $12 = ((($op2)) + 56|0);
 $13 = ((($op2)) + 88|0);
 $14 = ((($op2)) + 120|0);
 $r$02 = 0;
 while(1) {
  $15 = $r$02 << 2;
  $16 = (($op1) + ($15<<3)|0);
  $17 = $15 | 1;
  $18 = (($op1) + ($17<<3)|0);
  $19 = $15 | 2;
  $20 = (($op1) + ($19<<3)|0);
  $21 = $15 | 3;
  $22 = (($op1) + ($21<<3)|0);
  $23 = +HEAPF64[$16>>3];
  $24 = +HEAPF64[$op2>>3];
  $25 = $23 * $24;
  $26 = +HEAPF64[$18>>3];
  $27 = +HEAPF64[$0>>3];
  $28 = $26 * $27;
  $29 = $25 + $28;
  $30 = +HEAPF64[$20>>3];
  $31 = +HEAPF64[$1>>3];
  $32 = $30 * $31;
  $33 = $29 + $32;
  $34 = +HEAPF64[$22>>3];
  $35 = +HEAPF64[$2>>3];
  $36 = $34 * $35;
  $37 = $33 + $36;
  $38 = (($dst) + ($15<<3)|0);
  HEAPF64[$38>>3] = $37;
  $39 = +HEAPF64[$16>>3];
  $40 = +HEAPF64[$3>>3];
  $41 = $39 * $40;
  $42 = +HEAPF64[$18>>3];
  $43 = +HEAPF64[$4>>3];
  $44 = $42 * $43;
  $45 = $41 + $44;
  $46 = +HEAPF64[$20>>3];
  $47 = +HEAPF64[$5>>3];
  $48 = $46 * $47;
  $49 = $45 + $48;
  $50 = +HEAPF64[$22>>3];
  $51 = +HEAPF64[$6>>3];
  $52 = $50 * $51;
  $53 = $49 + $52;
  $54 = $15 | 1;
  $55 = (($dst) + ($54<<3)|0);
  HEAPF64[$55>>3] = $53;
  $56 = +HEAPF64[$16>>3];
  $57 = +HEAPF64[$7>>3];
  $58 = $56 * $57;
  $59 = +HEAPF64[$18>>3];
  $60 = +HEAPF64[$8>>3];
  $61 = $59 * $60;
  $62 = $58 + $61;
  $63 = +HEAPF64[$20>>3];
  $64 = +HEAPF64[$9>>3];
  $65 = $63 * $64;
  $66 = $62 + $65;
  $67 = +HEAPF64[$22>>3];
  $68 = +HEAPF64[$10>>3];
  $69 = $67 * $68;
  $70 = $66 + $69;
  $71 = $15 | 2;
  $72 = (($dst) + ($71<<3)|0);
  HEAPF64[$72>>3] = $70;
  $73 = +HEAPF64[$16>>3];
  $74 = +HEAPF64[$11>>3];
  $75 = $73 * $74;
  $76 = +HEAPF64[$18>>3];
  $77 = +HEAPF64[$12>>3];
  $78 = $76 * $77;
  $79 = $75 + $78;
  $80 = +HEAPF64[$20>>3];
  $81 = +HEAPF64[$13>>3];
  $82 = $80 * $81;
  $83 = $79 + $82;
  $84 = +HEAPF64[$22>>3];
  $85 = +HEAPF64[$14>>3];
  $86 = $84 * $85;
  $87 = $83 + $86;
  $88 = $15 | 3;
  $89 = (($dst) + ($88<<3)|0);
  HEAPF64[$89>>3] = $87;
  $90 = (($r$02) + 1)|0;
  $exitcond3 = ($90|0)==(4);
  if ($exitcond3) {
   break;
  } else {
   $r$02 = $90;
  }
 }
 return;
}
function __GLOBAL__sub_I_base_cpp() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 ___cxx_global_var_init();
 return;
}
function ___cxx_global_var_init() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 HEAP32[11039] = 44156;
 HEAP32[(44160)>>2] = 44156;
 HEAP32[(44164)>>2] = 0;
 (___cxa_atexit((11|0),(44156|0),(___dso_handle|0))|0);
 return;
}
function __ZNSt3__110__list_impIPN4Base9BenchmarkENS_9allocatorIS3_EEED2Ev($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZNSt3__110__list_impIPN4Base9BenchmarkENS_9allocatorIS3_EEE5clearEv($this);
 return;
}
function __ZNSt3__110__list_impIPN4Base9BenchmarkENS_9allocatorIS3_EEE5clearEv($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $__f$01 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($this)) + 8|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)==(0);
 if ($2) {
  return;
 }
 $3 = ((($this)) + 4|0);
 $4 = HEAP32[$3>>2]|0;
 $5 = HEAP32[$this>>2]|0;
 $6 = ((($5)) + 4|0);
 $7 = HEAP32[$6>>2]|0;
 $8 = HEAP32[$4>>2]|0;
 $9 = ((($8)) + 4|0);
 HEAP32[$9>>2] = $7;
 $10 = HEAP32[$4>>2]|0;
 $11 = HEAP32[$6>>2]|0;
 HEAP32[$11>>2] = $10;
 HEAP32[$0>>2] = 0;
 $12 = ($4|0)==($this|0);
 if ($12) {
  return;
 } else {
  $__f$01 = $4;
 }
 while(1) {
  $13 = ((($__f$01)) + 4|0);
  $14 = HEAP32[$13>>2]|0;
  __ZdlPv($__f$01);
  $15 = ($14|0)==($this|0);
  if ($15) {
   break;
  } else {
   $__f$01 = $14;
  }
 }
 return;
}
function __ZN4Base10Benchmarks6runAllERNS_15OutputFunctionsEb($outputFunctions,$useAutoIterations) {
 $outputFunctions = $outputFunctions|0;
 $useAutoIterations = $useAutoIterations|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $it$sroa$0$01 = 0, $it$sroa$0$012 = 0, $it$sroa$0$013 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$outputFunctions>>2]|0;
 __ZL12printHeadersPFvPcE($0);
 $it$sroa$0$012 = HEAP32[(44160)>>2]|0;
 $1 = ($it$sroa$0$012|0)==(44156|0);
 if ($1) {
  return;
 }
 $2 = $useAutoIterations&1;
 $it$sroa$0$013 = $it$sroa$0$012;
 while(1) {
  $3 = ((($it$sroa$0$013)) + 8|0);
  $4 = HEAP32[$3>>2]|0;
  $5 = ((($4)) + 4|0);
  HEAP8[$5>>0] = $2;
  __ZL6runOnePN4Base9BenchmarkE($4);
  __ZL6reportPN4Base9BenchmarkERNS_15OutputFunctionsE($4,$outputFunctions);
  $6 = ((($it$sroa$0$013)) + 4|0);
  $it$sroa$0$01 = HEAP32[$6>>2]|0;
  $7 = ($it$sroa$0$01|0)==(44156|0);
  if ($7) {
   break;
  } else {
   $it$sroa$0$013 = $it$sroa$0$01;
  }
 }
 return;
}
function __ZL12printHeadersPFvPcE($printFunction) {
 $printFunction = $printFunction|0;
 var $buf = 0, $vararg_buffer = 0, $vararg_ptr1 = 0, $vararg_ptr2 = 0, $vararg_ptr3 = 0, $vararg_ptr4 = 0, $vararg_ptr5 = 0, $vararg_ptr6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 240|0;
 $vararg_buffer = sp;
 $buf = sp + 32|0;
 HEAP32[$vararg_buffer>>2] = 709;
 $vararg_ptr1 = ((($vararg_buffer)) + 4|0);
 HEAP32[$vararg_ptr1>>2] = 714;
 $vararg_ptr2 = ((($vararg_buffer)) + 8|0);
 HEAP32[$vararg_ptr2>>2] = 725;
 $vararg_ptr3 = ((($vararg_buffer)) + 12|0);
 HEAP32[$vararg_ptr3>>2] = 738;
 $vararg_ptr4 = ((($vararg_buffer)) + 16|0);
 HEAP32[$vararg_ptr4>>2] = 751;
 $vararg_ptr5 = ((($vararg_buffer)) + 20|0);
 HEAP32[$vararg_ptr5>>2] = 762;
 $vararg_ptr6 = ((($vararg_buffer)) + 24|0);
 HEAP32[$vararg_ptr6>>2] = 770;
 (_sprintf($buf,671,$vararg_buffer)|0);
 FUNCTION_TABLE_vi[$printFunction & 15]($buf);
 STACKTOP = sp;return;
}
function __ZL6runOnePN4Base9BenchmarkE($benchmark) {
 $benchmark = $benchmark|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0;
 var $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0;
 var $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0;
 var $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$benchmark>>2]|0;
 $1 = ((($0)) + 12|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = (FUNCTION_TABLE_i[$2 & 15]()|0);
 if (!($3)) {
  $4 = ((($benchmark)) + 5|0);
  HEAP8[$4>>0] = 0;
  return;
 }
 $5 = ((($benchmark)) + 4|0);
 $6 = HEAP8[$5>>0]|0;
 $7 = ($6<<24>>24)==(0);
 if ($7) {
  $20 = HEAP32[$benchmark>>2]|0;
  $21 = ((($20)) + 32|0);
  $22 = $21;
  $23 = $22;
  $24 = HEAP32[$23>>2]|0;
  $25 = (($22) + 4)|0;
  $26 = $25;
  $27 = HEAP32[$26>>2]|0;
  $28 = ((($benchmark)) + 16|0);
  $29 = $28;
  $30 = $29;
  HEAP32[$30>>2] = $24;
  $31 = (($29) + 4)|0;
  $32 = $31;
  HEAP32[$32>>2] = $27;
 } else {
  $8 = (__ZL17computeIterationsPN4Base9BenchmarkE($benchmark)|0);
  $9 = tempRet0;
  $10 = ((($benchmark)) + 8|0);
  $11 = $10;
  $12 = $11;
  HEAP32[$12>>2] = $8;
  $13 = (($11) + 4)|0;
  $14 = $13;
  HEAP32[$14>>2] = $9;
  $15 = ((($benchmark)) + 16|0);
  $16 = $15;
  $17 = $16;
  HEAP32[$17>>2] = $8;
  $18 = (($16) + 4)|0;
  $19 = $18;
  HEAP32[$19>>2] = $9;
 }
 $33 = HEAP32[$benchmark>>2]|0;
 $34 = ((($33)) + 20|0);
 $35 = HEAP32[$34>>2]|0;
 $36 = ((($benchmark)) + 16|0);
 $37 = $36;
 $38 = $37;
 $39 = HEAP32[$38>>2]|0;
 $40 = (($37) + 4)|0;
 $41 = $40;
 $42 = HEAP32[$41>>2]|0;
 $43 = (__ZL10timeKernelPFyyEy($35,$39,$42)|0);
 $44 = tempRet0;
 $45 = ((($benchmark)) + 24|0);
 $46 = $45;
 $47 = $46;
 HEAP32[$47>>2] = $43;
 $48 = (($46) + 4)|0;
 $49 = $48;
 HEAP32[$49>>2] = $44;
 $50 = HEAP32[$benchmark>>2]|0;
 $51 = ((($50)) + 24|0);
 $52 = HEAP32[$51>>2]|0;
 $53 = $36;
 $54 = $53;
 $55 = HEAP32[$54>>2]|0;
 $56 = (($53) + 4)|0;
 $57 = $56;
 $58 = HEAP32[$57>>2]|0;
 $59 = (__ZL10timeKernelPFyyEy($52,$55,$58)|0);
 $60 = tempRet0;
 $61 = ((($benchmark)) + 32|0);
 $62 = $61;
 $63 = $62;
 HEAP32[$63>>2] = $59;
 $64 = (($62) + 4)|0;
 $65 = $64;
 HEAP32[$65>>2] = $60;
 $66 = HEAP32[$benchmark>>2]|0;
 $67 = ((($66)) + 28|0);
 $68 = HEAP32[$67>>2]|0;
 $69 = $36;
 $70 = $69;
 $71 = HEAP32[$70>>2]|0;
 $72 = (($69) + 4)|0;
 $73 = $72;
 $74 = HEAP32[$73>>2]|0;
 $75 = (__ZL10timeKernelPFyyEy($68,$71,$74)|0);
 $76 = tempRet0;
 $77 = ((($benchmark)) + 40|0);
 $78 = $77;
 $79 = $78;
 HEAP32[$79>>2] = $75;
 $80 = (($78) + 4)|0;
 $81 = $80;
 HEAP32[$81>>2] = $76;
 $82 = HEAP32[$benchmark>>2]|0;
 $83 = ((($82)) + 16|0);
 $84 = HEAP32[$83>>2]|0;
 $85 = (FUNCTION_TABLE_i[$84 & 15]()|0);
 if ($85) {
  return;
 }
 $86 = ((($benchmark)) + 6|0);
 HEAP8[$86>>0] = 0;
 return;
}
function __ZL17computeIterationsPN4Base9BenchmarkE($benchmark) {
 $benchmark = $benchmark|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0;
 var $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0;
 var $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$benchmark>>2]|0;
 $1 = ((($0)) + 20|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = (__ZL10timeKernelPFyyEy($2,10,0)|0);
 $4 = tempRet0;
 $5 = HEAP32[$benchmark>>2]|0;
 $6 = ((($5)) + 24|0);
 $7 = HEAP32[$6>>2]|0;
 $8 = (__ZL10timeKernelPFyyEy($7,10,0)|0);
 $9 = tempRet0;
 $10 = ($4>>>0)>($9>>>0);
 $11 = ($3>>>0)>($8>>>0);
 $12 = ($4|0)==($9|0);
 $13 = $12 & $11;
 $14 = $10 | $13;
 $15 = $14 ? $3 : $8;
 $16 = $14 ? $4 : $9;
 $17 = ($16>>>0)<(0);
 $18 = ($15>>>0)<(500);
 $19 = ($16|0)==(0);
 $20 = $19 & $18;
 $21 = $17 | $20;
 if ($21) {
  $22 = 10;$23 = 0;
 } else {
  $53 = $4;$54 = $9;$56 = $3;$57 = $8;$63 = 10000;$64 = 0;
  $52 = ($53>>>0)>($54>>>0);
  $55 = ($56>>>0)>($57>>>0);
  $58 = ($53|0)==($54|0);
  $59 = $58 & $55;
  $60 = $52 | $59;
  $61 = $60 ? $56 : $57;
  $62 = $60 ? $53 : $54;
  $65 = (___udivdi3(($63|0),($64|0),($61|0),($62|0))|0);
  $66 = tempRet0;
  tempRet0 = ($66);
  return ($65|0);
 }
 while(1) {
  $24 = (_bitshift64Shl(($22|0),($23|0),1)|0);
  $25 = tempRet0;
  $26 = HEAP32[$benchmark>>2]|0;
  $27 = ((($26)) + 20|0);
  $28 = HEAP32[$27>>2]|0;
  $29 = (__ZL10timeKernelPFyyEy($28,$24,$25)|0);
  $30 = tempRet0;
  $31 = HEAP32[$benchmark>>2]|0;
  $32 = ((($31)) + 24|0);
  $33 = HEAP32[$32>>2]|0;
  $34 = (__ZL10timeKernelPFyyEy($33,$24,$25)|0);
  $35 = tempRet0;
  $36 = ($30>>>0)>($35>>>0);
  $37 = ($29>>>0)>($34>>>0);
  $38 = ($30|0)==($35|0);
  $39 = $38 & $37;
  $40 = $36 | $39;
  $41 = $40 ? $29 : $34;
  $42 = $40 ? $30 : $35;
  $43 = ($42>>>0)<(0);
  $44 = ($41>>>0)<(500);
  $45 = ($42|0)==(0);
  $46 = $45 & $44;
  $47 = $43 | $46;
  if ($47) {
   $22 = $24;$23 = $25;
  } else {
   $48 = $22;$49 = $23;$67 = $34;$68 = $35;$69 = $29;$70 = $30;
   break;
  }
 }
 $50 = (___muldi3(($48|0),($49|0),2000,0)|0);
 $51 = tempRet0;
 $53 = $70;$54 = $68;$56 = $69;$57 = $67;$63 = $50;$64 = $51;
 $52 = ($53>>>0)>($54>>>0);
 $55 = ($56>>>0)>($57>>>0);
 $58 = ($53|0)==($54|0);
 $59 = $58 & $55;
 $60 = $52 | $59;
 $61 = $60 ? $56 : $57;
 $62 = $60 ? $53 : $54;
 $65 = (___udivdi3(($63|0),($64|0),($61|0),($62|0))|0);
 $66 = tempRet0;
 tempRet0 = ($66);
 return ($65|0);
}
function __ZL10timeKernelPFyyEy($kernel,$0,$1) {
 $kernel = $kernel|0;
 $0 = $0|0;
 $1 = $1|0;
 var $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = (__ZL3nowv()|0);
 $3 = tempRet0;
 (FUNCTION_TABLE_iii[$kernel & 31]($0,$1)|0);
 $4 = tempRet0;
 $5 = (__ZL3nowv()|0);
 $6 = tempRet0;
 $7 = (_i64Subtract(($5|0),($6|0),($2|0),($3|0))|0);
 $8 = tempRet0;
 tempRet0 = ($8);
 return ($7|0);
}
function __ZL3nowv() {
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $time = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $time = sp;
 (_ftime(($time|0))|0);
 $0 = HEAP32[$time>>2]|0;
 $1 = ($0*1000)|0;
 $2 = ((($time)) + 4|0);
 $3 = HEAP16[$2>>1]|0;
 $4 = $3&65535;
 $5 = (($4) + ($1))|0;
 $6 = ($5|0)<(0);
 $7 = $6 << 31 >> 31;
 tempRet0 = ($7);
 STACKTOP = sp;return ($5|0);
}
function __ZL6reportPN4Base9BenchmarkERNS_15OutputFunctionsE($benchmark,$outputFunctions) {
 $benchmark = $benchmark|0;
 $outputFunctions = $outputFunctions|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0.0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0.0, $42 = 0.0, $43 = 0, $44 = 0;
 var $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0.0, $51 = 0.0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0;
 var $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0;
 var $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $buf = 0, $vararg_buffer = 0;
 var $vararg_buffer2 = 0, $vararg_ptr1 = 0, $vararg_ptr5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 224|0;
 $vararg_buffer2 = sp + 8|0;
 $vararg_buffer = sp;
 $buf = sp + 16|0;
 $0 = ((($benchmark)) + 5|0);
 $1 = HEAP8[$0>>0]|0;
 $2 = ($1<<24>>24)==(0);
 if ($2) {
  $3 = HEAP32[$benchmark>>2]|0;
  $4 = HEAP8[$3>>0]|0;
  $5 = $4 & 1;
  $6 = ($5<<24>>24)==(0);
  if ($6) {
   $9 = ((($3)) + 1|0);
   $10 = $9;
  } else {
   $7 = ((($3)) + 8|0);
   $8 = HEAP32[$7>>2]|0;
   $10 = $8;
  }
  HEAP32[$vararg_buffer>>2] = $10;
  $vararg_ptr1 = ((($vararg_buffer)) + 4|0);
  HEAP32[$vararg_ptr1>>2] = 785;
  (_sprintf($buf,778,$vararg_buffer)|0);
  $11 = ((($outputFunctions)) + 4|0);
  $12 = HEAP32[$11>>2]|0;
  FUNCTION_TABLE_vi[$12 & 15]($buf);
  STACKTOP = sp;return;
 }
 $13 = ((($benchmark)) + 6|0);
 $14 = HEAP8[$13>>0]|0;
 $15 = ($14<<24>>24)==(0);
 if ($15) {
  $16 = HEAP32[$benchmark>>2]|0;
  $17 = HEAP8[$16>>0]|0;
  $18 = $17 & 1;
  $19 = ($18<<24>>24)==(0);
  if ($19) {
   $22 = ((($16)) + 1|0);
   $23 = $22;
  } else {
   $20 = ((($16)) + 8|0);
   $21 = HEAP32[$20>>2]|0;
   $23 = $21;
  }
  HEAP32[$vararg_buffer2>>2] = $23;
  $vararg_ptr5 = ((($vararg_buffer2)) + 4|0);
  HEAP32[$vararg_ptr5>>2] = 797;
  (_sprintf($buf,778,$vararg_buffer2)|0);
  $24 = ((($outputFunctions)) + 4|0);
  $25 = HEAP32[$24>>2]|0;
  FUNCTION_TABLE_vi[$25 & 15]($buf);
  STACKTOP = sp;return;
 } else {
  $26 = ((($benchmark)) + 32|0);
  $27 = $26;
  $28 = $27;
  $29 = HEAP32[$28>>2]|0;
  $30 = (($27) + 4)|0;
  $31 = $30;
  $32 = HEAP32[$31>>2]|0;
  $33 = (+($29>>>0)) + (4294967296.0*(+($32>>>0)));
  $34 = ((($benchmark)) + 24|0);
  $35 = $34;
  $36 = $35;
  $37 = HEAP32[$36>>2]|0;
  $38 = (($35) + 4)|0;
  $39 = $38;
  $40 = HEAP32[$39>>2]|0;
  $41 = (+($37>>>0)) + (4294967296.0*(+($40>>>0)));
  $42 = $33 / $41;
  $43 = ((($benchmark)) + 40|0);
  $44 = $43;
  $45 = $44;
  $46 = HEAP32[$45>>2]|0;
  $47 = (($44) + 4)|0;
  $48 = $47;
  $49 = HEAP32[$48>>2]|0;
  $50 = (+($46>>>0)) + (4294967296.0*(+($49>>>0)));
  $51 = $50 / $41;
  $52 = HEAP32[$outputFunctions>>2]|0;
  $53 = HEAP32[$benchmark>>2]|0;
  $54 = HEAP8[$53>>0]|0;
  $55 = $54 & 1;
  $56 = ($55<<24>>24)==(0);
  if ($56) {
   $59 = ((($53)) + 1|0);
   $97 = $59;
  } else {
   $57 = ((($53)) + 8|0);
   $58 = HEAP32[$57>>2]|0;
   $97 = $58;
  }
  $60 = ((($benchmark)) + 16|0);
  $61 = $60;
  $62 = $61;
  $63 = HEAP32[$62>>2]|0;
  $64 = (($61) + 4)|0;
  $65 = $64;
  $66 = HEAP32[$65>>2]|0;
  $67 = $26;
  $68 = $67;
  $69 = HEAP32[$68>>2]|0;
  $70 = (($67) + 4)|0;
  $71 = $70;
  $72 = HEAP32[$71>>2]|0;
  $73 = (___muldi3(($69|0),($72|0),1000000,0)|0);
  $74 = tempRet0;
  $75 = (___udivdi3(($73|0),($74|0),($63|0),($66|0))|0);
  $76 = tempRet0;
  $77 = $43;
  $78 = $77;
  $79 = HEAP32[$78>>2]|0;
  $80 = (($77) + 4)|0;
  $81 = $80;
  $82 = HEAP32[$81>>2]|0;
  $83 = (___muldi3(($79|0),($82|0),1000000,0)|0);
  $84 = tempRet0;
  $85 = (___udivdi3(($83|0),($84|0),($63|0),($66|0))|0);
  $86 = tempRet0;
  $87 = $34;
  $88 = $87;
  $89 = HEAP32[$88>>2]|0;
  $90 = (($87) + 4)|0;
  $91 = $90;
  $92 = HEAP32[$91>>2]|0;
  $93 = (___muldi3(($89|0),($92|0),1000000,0)|0);
  $94 = tempRet0;
  $95 = (___udivdi3(($93|0),($94|0),($63|0),($66|0))|0);
  $96 = tempRet0;
  __ZL12printColumnsPFvPcEPKcyyyydd($52,$97,$63,$66,$75,$76,$85,$86,$95,$96,$42,$51);
  STACKTOP = sp;return;
 }
}
function __ZL12printColumnsPFvPcEPKcyyyydd($printFunction,$name,$0,$1,$2,$3,$4,$5,$6,$7,$ratio32,$ratio64) {
 $printFunction = $printFunction|0;
 $name = $name|0;
 $0 = $0|0;
 $1 = $1|0;
 $2 = $2|0;
 $3 = $3|0;
 $4 = $4|0;
 $5 = $5|0;
 $6 = $6|0;
 $7 = $7|0;
 $ratio32 = +$ratio32;
 $ratio64 = +$ratio64;
 var $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $8 = 0, $9 = 0, $buf = 0, $vararg_buffer = 0, $vararg_ptr1 = 0, $vararg_ptr2 = 0;
 var $vararg_ptr3 = 0, $vararg_ptr4 = 0, $vararg_ptr5 = 0, $vararg_ptr6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 256|0;
 $vararg_buffer = sp;
 $buf = sp + 56|0;
 HEAP32[$vararg_buffer>>2] = $name;
 $vararg_ptr1 = ((($vararg_buffer)) + 8|0);
 $8 = $vararg_ptr1;
 $9 = $8;
 HEAP32[$9>>2] = $0;
 $10 = (($8) + 4)|0;
 $11 = $10;
 HEAP32[$11>>2] = $1;
 $vararg_ptr2 = ((($vararg_buffer)) + 16|0);
 $12 = $vararg_ptr2;
 $13 = $12;
 HEAP32[$13>>2] = $2;
 $14 = (($12) + 4)|0;
 $15 = $14;
 HEAP32[$15>>2] = $3;
 $vararg_ptr3 = ((($vararg_buffer)) + 24|0);
 $16 = $vararg_ptr3;
 $17 = $16;
 HEAP32[$17>>2] = $4;
 $18 = (($16) + 4)|0;
 $19 = $18;
 HEAP32[$19>>2] = $5;
 $vararg_ptr4 = ((($vararg_buffer)) + 32|0);
 $20 = $vararg_ptr4;
 $21 = $20;
 HEAP32[$21>>2] = $6;
 $22 = (($20) + 4)|0;
 $23 = $22;
 HEAP32[$23>>2] = $7;
 $vararg_ptr5 = ((($vararg_buffer)) + 40|0);
 HEAPF64[$vararg_ptr5>>3] = $ratio32;
 $vararg_ptr6 = ((($vararg_buffer)) + 48|0);
 HEAPF64[$vararg_ptr6>>3] = $ratio64;
 (_sprintf($buf,812,$vararg_buffer)|0);
 FUNCTION_TABLE_vi[$printFunction & 15]($buf);
 STACKTOP = sp;return;
}
function __ZN4Base10Benchmarks3addEPNS_9BenchmarkE($benchmark) {
 $benchmark = $benchmark|0;
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $0 = sp;
 HEAP32[$0>>2] = $benchmark;
 __ZNSt3__14listIPN4Base9BenchmarkENS_9allocatorIS3_EEE9push_backERKS3_(44156,$0);
 STACKTOP = sp;return;
}
function __ZNSt3__14listIPN4Base9BenchmarkENS_9allocatorIS3_EEE9push_backERKS3_($this,$__x) {
 $this = $this|0;
 $__x = $__x|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__Znwj(12)|0);
 $1 = ((($0)) + 8|0);
 $2 = HEAP32[$__x>>2]|0;
 HEAP32[$1>>2] = $2;
 $3 = ((($0)) + 4|0);
 HEAP32[$3>>2] = $this;
 $4 = HEAP32[$this>>2]|0;
 HEAP32[$0>>2] = $4;
 $5 = ((($4)) + 4|0);
 HEAP32[$5>>2] = $0;
 HEAP32[$this>>2] = $0;
 $6 = ((($this)) + 8|0);
 $7 = HEAP32[$6>>2]|0;
 $8 = (($7) + 1)|0;
 HEAP32[$6>>2] = $8;
 return;
}
function ___stdio_close($f) {
 $f = $f|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $vararg_buffer = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $vararg_buffer = sp;
 $0 = ((($f)) + 60|0);
 $1 = HEAP32[$0>>2]|0;
 HEAP32[$vararg_buffer>>2] = $1;
 $2 = (___syscall6(6,($vararg_buffer|0))|0);
 $3 = (___syscall_ret($2)|0);
 STACKTOP = sp;return ($3|0);
}
function ___syscall_ret($r) {
 $r = $r|0;
 var $$0 = 0, $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ($r>>>0)>(4294963200);
 if ($0) {
  $1 = (0 - ($r))|0;
  $2 = (___errno_location()|0);
  HEAP32[$2>>2] = $1;
  $$0 = -1;
 } else {
  $$0 = $r;
 }
 return ($$0|0);
}
function ___errno_location() {
 var $$0 = 0, $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[11042]|0;
 $1 = ($0|0)==(0|0);
 if ($1) {
  $$0 = 44212;
 } else {
  $2 = (_pthread_self()|0);
  $3 = ((($2)) + 64|0);
  $4 = HEAP32[$3>>2]|0;
  $$0 = $4;
 }
 return ($$0|0);
}
function ___stdio_write($f,$buf,$len) {
 $f = $f|0;
 $buf = $buf|0;
 $len = $len|0;
 var $$0 = 0, $$phi$trans$insert = 0, $$pre = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0;
 var $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0;
 var $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $cnt$0 = 0, $cnt$1 = 0, $iov$0 = 0, $iov$0$lcssa11 = 0, $iov$1 = 0, $iovcnt$0 = 0, $iovcnt$0$lcssa12 = 0;
 var $iovcnt$1 = 0, $iovs = 0, $rem$0 = 0, $vararg_buffer = 0, $vararg_buffer3 = 0, $vararg_ptr1 = 0, $vararg_ptr2 = 0, $vararg_ptr6 = 0, $vararg_ptr7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0;
 $vararg_buffer3 = sp + 16|0;
 $vararg_buffer = sp;
 $iovs = sp + 32|0;
 $0 = ((($f)) + 28|0);
 $1 = HEAP32[$0>>2]|0;
 HEAP32[$iovs>>2] = $1;
 $2 = ((($iovs)) + 4|0);
 $3 = ((($f)) + 20|0);
 $4 = HEAP32[$3>>2]|0;
 $5 = (($4) - ($1))|0;
 HEAP32[$2>>2] = $5;
 $6 = ((($iovs)) + 8|0);
 HEAP32[$6>>2] = $buf;
 $7 = ((($iovs)) + 12|0);
 HEAP32[$7>>2] = $len;
 $8 = (($5) + ($len))|0;
 $9 = ((($f)) + 60|0);
 $10 = ((($f)) + 44|0);
 $iov$0 = $iovs;$iovcnt$0 = 2;$rem$0 = $8;
 while(1) {
  $11 = HEAP32[11042]|0;
  $12 = ($11|0)==(0|0);
  if ($12) {
   $16 = HEAP32[$9>>2]|0;
   HEAP32[$vararg_buffer3>>2] = $16;
   $vararg_ptr6 = ((($vararg_buffer3)) + 4|0);
   HEAP32[$vararg_ptr6>>2] = $iov$0;
   $vararg_ptr7 = ((($vararg_buffer3)) + 8|0);
   HEAP32[$vararg_ptr7>>2] = $iovcnt$0;
   $17 = (___syscall146(146,($vararg_buffer3|0))|0);
   $18 = (___syscall_ret($17)|0);
   $cnt$0 = $18;
  } else {
   _pthread_cleanup_push((12|0),($f|0));
   $13 = HEAP32[$9>>2]|0;
   HEAP32[$vararg_buffer>>2] = $13;
   $vararg_ptr1 = ((($vararg_buffer)) + 4|0);
   HEAP32[$vararg_ptr1>>2] = $iov$0;
   $vararg_ptr2 = ((($vararg_buffer)) + 8|0);
   HEAP32[$vararg_ptr2>>2] = $iovcnt$0;
   $14 = (___syscall146(146,($vararg_buffer|0))|0);
   $15 = (___syscall_ret($14)|0);
   _pthread_cleanup_pop(0);
   $cnt$0 = $15;
  }
  $19 = ($rem$0|0)==($cnt$0|0);
  if ($19) {
   label = 6;
   break;
  }
  $26 = ($cnt$0|0)<(0);
  if ($26) {
   $iov$0$lcssa11 = $iov$0;$iovcnt$0$lcssa12 = $iovcnt$0;
   label = 8;
   break;
  }
  $34 = (($rem$0) - ($cnt$0))|0;
  $35 = ((($iov$0)) + 4|0);
  $36 = HEAP32[$35>>2]|0;
  $37 = ($cnt$0>>>0)>($36>>>0);
  if ($37) {
   $38 = HEAP32[$10>>2]|0;
   HEAP32[$0>>2] = $38;
   HEAP32[$3>>2] = $38;
   $39 = (($cnt$0) - ($36))|0;
   $40 = ((($iov$0)) + 8|0);
   $41 = (($iovcnt$0) + -1)|0;
   $$phi$trans$insert = ((($iov$0)) + 12|0);
   $$pre = HEAP32[$$phi$trans$insert>>2]|0;
   $49 = $$pre;$cnt$1 = $39;$iov$1 = $40;$iovcnt$1 = $41;
  } else {
   $42 = ($iovcnt$0|0)==(2);
   if ($42) {
    $43 = HEAP32[$0>>2]|0;
    $44 = (($43) + ($cnt$0)|0);
    HEAP32[$0>>2] = $44;
    $49 = $36;$cnt$1 = $cnt$0;$iov$1 = $iov$0;$iovcnt$1 = 2;
   } else {
    $49 = $36;$cnt$1 = $cnt$0;$iov$1 = $iov$0;$iovcnt$1 = $iovcnt$0;
   }
  }
  $45 = HEAP32[$iov$1>>2]|0;
  $46 = (($45) + ($cnt$1)|0);
  HEAP32[$iov$1>>2] = $46;
  $47 = ((($iov$1)) + 4|0);
  $48 = (($49) - ($cnt$1))|0;
  HEAP32[$47>>2] = $48;
  $iov$0 = $iov$1;$iovcnt$0 = $iovcnt$1;$rem$0 = $34;
 }
 if ((label|0) == 6) {
  $20 = HEAP32[$10>>2]|0;
  $21 = ((($f)) + 48|0);
  $22 = HEAP32[$21>>2]|0;
  $23 = (($20) + ($22)|0);
  $24 = ((($f)) + 16|0);
  HEAP32[$24>>2] = $23;
  $25 = $20;
  HEAP32[$0>>2] = $25;
  HEAP32[$3>>2] = $25;
  $$0 = $len;
 }
 else if ((label|0) == 8) {
  $27 = ((($f)) + 16|0);
  HEAP32[$27>>2] = 0;
  HEAP32[$0>>2] = 0;
  HEAP32[$3>>2] = 0;
  $28 = HEAP32[$f>>2]|0;
  $29 = $28 | 32;
  HEAP32[$f>>2] = $29;
  $30 = ($iovcnt$0$lcssa12|0)==(2);
  if ($30) {
   $$0 = 0;
  } else {
   $31 = ((($iov$0$lcssa11)) + 4|0);
   $32 = HEAP32[$31>>2]|0;
   $33 = (($len) - ($32))|0;
   $$0 = $33;
  }
 }
 STACKTOP = sp;return ($$0|0);
}
function _cleanup_522($p) {
 $p = $p|0;
 var $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($p)) + 68|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)==(0);
 if ($2) {
  ___unlockfile($p);
 }
 return;
}
function ___unlockfile($f) {
 $f = $f|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function ___stdio_seek($f,$off,$whence) {
 $f = $f|0;
 $off = $off|0;
 $whence = $whence|0;
 var $$pre = 0, $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $ret = 0, $vararg_buffer = 0, $vararg_ptr1 = 0, $vararg_ptr2 = 0, $vararg_ptr3 = 0, $vararg_ptr4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 32|0;
 $vararg_buffer = sp;
 $ret = sp + 20|0;
 $0 = ((($f)) + 60|0);
 $1 = HEAP32[$0>>2]|0;
 HEAP32[$vararg_buffer>>2] = $1;
 $vararg_ptr1 = ((($vararg_buffer)) + 4|0);
 HEAP32[$vararg_ptr1>>2] = 0;
 $vararg_ptr2 = ((($vararg_buffer)) + 8|0);
 HEAP32[$vararg_ptr2>>2] = $off;
 $vararg_ptr3 = ((($vararg_buffer)) + 12|0);
 HEAP32[$vararg_ptr3>>2] = $ret;
 $vararg_ptr4 = ((($vararg_buffer)) + 16|0);
 HEAP32[$vararg_ptr4>>2] = $whence;
 $2 = (___syscall140(140,($vararg_buffer|0))|0);
 $3 = (___syscall_ret($2)|0);
 $4 = ($3|0)<(0);
 if ($4) {
  HEAP32[$ret>>2] = -1;
  $5 = -1;
 } else {
  $$pre = HEAP32[$ret>>2]|0;
  $5 = $$pre;
 }
 STACKTOP = sp;return ($5|0);
}
function ___stdout_write($f,$buf,$len) {
 $f = $f|0;
 $buf = $buf|0;
 $len = $len|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $tio = 0, $vararg_buffer = 0, $vararg_ptr1 = 0, $vararg_ptr2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 80|0;
 $vararg_buffer = sp;
 $tio = sp + 12|0;
 $0 = ((($f)) + 36|0);
 HEAP32[$0>>2] = 1;
 $1 = HEAP32[$f>>2]|0;
 $2 = $1 & 64;
 $3 = ($2|0)==(0);
 if ($3) {
  $4 = ((($f)) + 60|0);
  $5 = HEAP32[$4>>2]|0;
  HEAP32[$vararg_buffer>>2] = $5;
  $vararg_ptr1 = ((($vararg_buffer)) + 4|0);
  HEAP32[$vararg_ptr1>>2] = 21505;
  $vararg_ptr2 = ((($vararg_buffer)) + 8|0);
  HEAP32[$vararg_ptr2>>2] = $tio;
  $6 = (___syscall54(54,($vararg_buffer|0))|0);
  $7 = ($6|0)==(0);
  if (!($7)) {
   $8 = ((($f)) + 75|0);
   HEAP8[$8>>0] = -1;
  }
 }
 $9 = (___stdio_write($f,$buf,$len)|0);
 STACKTOP = sp;return ($9|0);
}
function _memchr($src,$c,$n) {
 $src = $src|0;
 $c = $c|0;
 $n = $n|0;
 var $$0$lcssa = 0, $$0$lcssa30 = 0, $$019 = 0, $$1$lcssa = 0, $$110 = 0, $$110$lcssa = 0, $$24 = 0, $$3 = 0, $$lcssa = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0;
 var $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0;
 var $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, $or$cond18 = 0, $s$0$lcssa = 0, $s$0$lcssa29 = 0, $s$020 = 0, $s$15 = 0, $s$2 = 0, $w$0$lcssa = 0, $w$011 = 0, $w$011$lcssa = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = $c & 255;
 $1 = $src;
 $2 = $1 & 3;
 $3 = ($2|0)!=(0);
 $4 = ($n|0)!=(0);
 $or$cond18 = $4 & $3;
 L1: do {
  if ($or$cond18) {
   $5 = $c&255;
   $$019 = $n;$s$020 = $src;
   while(1) {
    $6 = HEAP8[$s$020>>0]|0;
    $7 = ($6<<24>>24)==($5<<24>>24);
    if ($7) {
     $$0$lcssa30 = $$019;$s$0$lcssa29 = $s$020;
     label = 6;
     break L1;
    }
    $8 = ((($s$020)) + 1|0);
    $9 = (($$019) + -1)|0;
    $10 = $8;
    $11 = $10 & 3;
    $12 = ($11|0)!=(0);
    $13 = ($9|0)!=(0);
    $or$cond = $13 & $12;
    if ($or$cond) {
     $$019 = $9;$s$020 = $8;
    } else {
     $$0$lcssa = $9;$$lcssa = $13;$s$0$lcssa = $8;
     label = 5;
     break;
    }
   }
  } else {
   $$0$lcssa = $n;$$lcssa = $4;$s$0$lcssa = $src;
   label = 5;
  }
 } while(0);
 if ((label|0) == 5) {
  if ($$lcssa) {
   $$0$lcssa30 = $$0$lcssa;$s$0$lcssa29 = $s$0$lcssa;
   label = 6;
  } else {
   $$3 = 0;$s$2 = $s$0$lcssa;
  }
 }
 L8: do {
  if ((label|0) == 6) {
   $14 = HEAP8[$s$0$lcssa29>>0]|0;
   $15 = $c&255;
   $16 = ($14<<24>>24)==($15<<24>>24);
   if ($16) {
    $$3 = $$0$lcssa30;$s$2 = $s$0$lcssa29;
   } else {
    $17 = Math_imul($0, 16843009)|0;
    $18 = ($$0$lcssa30>>>0)>(3);
    L11: do {
     if ($18) {
      $$110 = $$0$lcssa30;$w$011 = $s$0$lcssa29;
      while(1) {
       $19 = HEAP32[$w$011>>2]|0;
       $20 = $19 ^ $17;
       $21 = (($20) + -16843009)|0;
       $22 = $20 & -2139062144;
       $23 = $22 ^ -2139062144;
       $24 = $23 & $21;
       $25 = ($24|0)==(0);
       if (!($25)) {
        $$110$lcssa = $$110;$w$011$lcssa = $w$011;
        break;
       }
       $26 = ((($w$011)) + 4|0);
       $27 = (($$110) + -4)|0;
       $28 = ($27>>>0)>(3);
       if ($28) {
        $$110 = $27;$w$011 = $26;
       } else {
        $$1$lcssa = $27;$w$0$lcssa = $26;
        label = 11;
        break L11;
       }
      }
      $$24 = $$110$lcssa;$s$15 = $w$011$lcssa;
     } else {
      $$1$lcssa = $$0$lcssa30;$w$0$lcssa = $s$0$lcssa29;
      label = 11;
     }
    } while(0);
    if ((label|0) == 11) {
     $29 = ($$1$lcssa|0)==(0);
     if ($29) {
      $$3 = 0;$s$2 = $w$0$lcssa;
      break;
     } else {
      $$24 = $$1$lcssa;$s$15 = $w$0$lcssa;
     }
    }
    while(1) {
     $30 = HEAP8[$s$15>>0]|0;
     $31 = ($30<<24>>24)==($15<<24>>24);
     if ($31) {
      $$3 = $$24;$s$2 = $s$15;
      break L8;
     }
     $32 = ((($s$15)) + 1|0);
     $33 = (($$24) + -1)|0;
     $34 = ($33|0)==(0);
     if ($34) {
      $$3 = 0;$s$2 = $32;
      break;
     } else {
      $$24 = $33;$s$15 = $32;
     }
    }
   }
  }
 } while(0);
 $35 = ($$3|0)!=(0);
 $36 = $35 ? $s$2 : 0;
 return ($36|0);
}
function _sprintf($s,$fmt,$varargs) {
 $s = $s|0;
 $fmt = $fmt|0;
 $varargs = $varargs|0;
 var $0 = 0, $ap = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $ap = sp;
 HEAP32[$ap>>2] = $varargs;
 $0 = (_vsprintf($s,$fmt,$ap)|0);
 STACKTOP = sp;return ($0|0);
}
function _vsprintf($s,$fmt,$ap) {
 $s = $s|0;
 $fmt = $fmt|0;
 $ap = $ap|0;
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_vsnprintf($s,2147483647,$fmt,$ap)|0);
 return ($0|0);
}
function _vsnprintf($s,$n,$fmt,$ap) {
 $s = $s|0;
 $n = $n|0;
 $fmt = $fmt|0;
 $ap = $ap|0;
 var $$$02 = 0, $$0 = 0, $$01 = 0, $$02 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0;
 var $6 = 0, $7 = 0, $8 = 0, $9 = 0, $b = 0, $f = 0, dest = 0, label = 0, sp = 0, src = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 128|0;
 $b = sp + 112|0;
 $f = sp;
 dest=$f; src=356; stop=dest+112|0; do { HEAP32[dest>>2]=HEAP32[src>>2]|0; dest=dest+4|0; src=src+4|0; } while ((dest|0) < (stop|0));
 $0 = (($n) + -1)|0;
 $1 = ($0>>>0)>(2147483646);
 if ($1) {
  $2 = ($n|0)==(0);
  if ($2) {
   $$01 = $b;$$02 = 1;
   label = 4;
  } else {
   $3 = (___errno_location()|0);
   HEAP32[$3>>2] = 75;
   $$0 = -1;
  }
 } else {
  $$01 = $s;$$02 = $n;
  label = 4;
 }
 if ((label|0) == 4) {
  $4 = $$01;
  $5 = (-2 - ($4))|0;
  $6 = ($$02>>>0)>($5>>>0);
  $$$02 = $6 ? $5 : $$02;
  $7 = ((($f)) + 48|0);
  HEAP32[$7>>2] = $$$02;
  $8 = ((($f)) + 20|0);
  HEAP32[$8>>2] = $$01;
  $9 = ((($f)) + 44|0);
  HEAP32[$9>>2] = $$01;
  $10 = (($$01) + ($$$02)|0);
  $11 = ((($f)) + 16|0);
  HEAP32[$11>>2] = $10;
  $12 = ((($f)) + 28|0);
  HEAP32[$12>>2] = $10;
  $13 = (_vfprintf($f,$fmt,$ap)|0);
  $14 = ($$$02|0)==(0);
  if ($14) {
   $$0 = $13;
  } else {
   $15 = HEAP32[$8>>2]|0;
   $16 = HEAP32[$11>>2]|0;
   $17 = ($15|0)==($16|0);
   $18 = $17 << 31 >> 31;
   $19 = (($15) + ($18)|0);
   HEAP8[$19>>0] = 0;
   $$0 = $13;
  }
 }
 STACKTOP = sp;return ($$0|0);
}
function _sn_write($f,$s,$l) {
 $f = $f|0;
 $s = $s|0;
 $l = $l|0;
 var $$cast = 0, $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $l$ = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($f)) + 16|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ((($f)) + 20|0);
 $3 = HEAP32[$2>>2]|0;
 $4 = (($1) - ($3))|0;
 $5 = ($4>>>0)>($l>>>0);
 $l$ = $5 ? $l : $4;
 $$cast = $3;
 _memcpy(($$cast|0),($s|0),($l$|0))|0;
 $6 = HEAP32[$2>>2]|0;
 $7 = (($6) + ($l$)|0);
 HEAP32[$2>>2] = $7;
 return ($l|0);
}
function _vfprintf($f,$fmt,$ap) {
 $f = $f|0;
 $fmt = $fmt|0;
 $ap = $ap|0;
 var $$ = 0, $$0 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0;
 var $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $ap2 = 0, $internal_buf = 0, $nl_arg = 0, $nl_type = 0;
 var $ret$1 = 0, $ret$1$ = 0, $vacopy_currentptr = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 224|0;
 $ap2 = sp + 120|0;
 $nl_type = sp + 80|0;
 $nl_arg = sp;
 $internal_buf = sp + 136|0;
 dest=$nl_type; stop=dest+40|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 $vacopy_currentptr = HEAP32[$ap>>2]|0;
 HEAP32[$ap2>>2] = $vacopy_currentptr;
 $0 = (_printf_core(0,$fmt,$ap2,$nl_arg,$nl_type)|0);
 $1 = ($0|0)<(0);
 if ($1) {
  $$0 = -1;
 } else {
  $2 = ((($f)) + 76|0);
  $3 = HEAP32[$2>>2]|0;
  $4 = ($3|0)>(-1);
  if ($4) {
   $5 = (___lockfile($f)|0);
   $33 = $5;
  } else {
   $33 = 0;
  }
  $6 = HEAP32[$f>>2]|0;
  $7 = $6 & 32;
  $8 = ((($f)) + 74|0);
  $9 = HEAP8[$8>>0]|0;
  $10 = ($9<<24>>24)<(1);
  if ($10) {
   $11 = $6 & -33;
   HEAP32[$f>>2] = $11;
  }
  $12 = ((($f)) + 48|0);
  $13 = HEAP32[$12>>2]|0;
  $14 = ($13|0)==(0);
  if ($14) {
   $16 = ((($f)) + 44|0);
   $17 = HEAP32[$16>>2]|0;
   HEAP32[$16>>2] = $internal_buf;
   $18 = ((($f)) + 28|0);
   HEAP32[$18>>2] = $internal_buf;
   $19 = ((($f)) + 20|0);
   HEAP32[$19>>2] = $internal_buf;
   HEAP32[$12>>2] = 80;
   $20 = ((($internal_buf)) + 80|0);
   $21 = ((($f)) + 16|0);
   HEAP32[$21>>2] = $20;
   $22 = (_printf_core($f,$fmt,$ap2,$nl_arg,$nl_type)|0);
   $23 = ($17|0)==(0|0);
   if ($23) {
    $ret$1 = $22;
   } else {
    $24 = ((($f)) + 36|0);
    $25 = HEAP32[$24>>2]|0;
    (FUNCTION_TABLE_iiii[$25 & 7]($f,0,0)|0);
    $26 = HEAP32[$19>>2]|0;
    $27 = ($26|0)==(0|0);
    $$ = $27 ? -1 : $22;
    HEAP32[$16>>2] = $17;
    HEAP32[$12>>2] = 0;
    HEAP32[$21>>2] = 0;
    HEAP32[$18>>2] = 0;
    HEAP32[$19>>2] = 0;
    $ret$1 = $$;
   }
  } else {
   $15 = (_printf_core($f,$fmt,$ap2,$nl_arg,$nl_type)|0);
   $ret$1 = $15;
  }
  $28 = HEAP32[$f>>2]|0;
  $29 = $28 & 32;
  $30 = ($29|0)==(0);
  $ret$1$ = $30 ? $ret$1 : -1;
  $31 = $28 | $7;
  HEAP32[$f>>2] = $31;
  $32 = ($33|0)==(0);
  if (!($32)) {
   ___unlockfile($f);
  }
  $$0 = $ret$1$;
 }
 STACKTOP = sp;return ($$0|0);
}
function _printf_core($f,$fmt,$ap,$nl_arg,$nl_type) {
 $f = $f|0;
 $fmt = $fmt|0;
 $ap = $ap|0;
 $nl_arg = $nl_arg|0;
 $nl_type = $nl_type|0;
 var $$ = 0, $$$i = 0, $$0 = 0, $$0$i = 0, $$0$lcssa$i = 0, $$012$i = 0, $$013$i = 0, $$03$i33 = 0, $$07$i = 0.0, $$1$i = 0.0, $$114$i = 0, $$2$i = 0.0, $$20$i = 0.0, $$210$$24$i = 0, $$210$$26$i = 0, $$210$i = 0, $$23$i = 0, $$25$i = 0, $$3$i = 0.0, $$311$i = 0;
 var $$33$i = 0, $$36$i = 0.0, $$4$i = 0.0, $$412$lcssa$i = 0, $$41278$i = 0, $$43 = 0, $$5$lcssa$i = 0, $$589$i = 0, $$a$3$i = 0, $$a$3191$i = 0, $$a$3192$i = 0, $$fl$4 = 0, $$l10n$0 = 0, $$lcssa = 0, $$lcssa162$i = 0, $$lcssa295 = 0, $$lcssa300 = 0, $$lcssa301 = 0, $$lcssa302 = 0, $$lcssa303 = 0;
 var $$lcssa304 = 0, $$lcssa306 = 0, $$lcssa316 = 0, $$lcssa319 = 0.0, $$lcssa321 = 0, $$neg55$i = 0, $$neg56$i = 0, $$p$$i = 0, $$p$5 = 0, $$p$i = 0, $$pn$i = 0, $$pr$i = 0, $$pr50$i = 0, $$pre = 0, $$pre$i = 0, $$pre$phi190$iZ2D = 0, $$pre170 = 0, $$pre171 = 0, $$pre185$i = 0, $$pre188$i = 0;
 var $$pre189$i = 0, $$z$3$i = 0, $$z$4$i = 0, $0 = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0;
 var $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0;
 var $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0;
 var $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0;
 var $168 = 0, $169 = 0, $17 = 0, $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0;
 var $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0;
 var $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0;
 var $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0;
 var $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0;
 var $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0;
 var $276 = 0, $277 = 0, $278 = 0, $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0;
 var $294 = 0, $295 = 0, $296 = 0, $297 = 0, $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0;
 var $311 = 0, $312 = 0, $313 = 0, $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0;
 var $33 = 0, $330 = 0, $331 = 0, $332 = 0, $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0, $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0;
 var $348 = 0, $349 = 0, $35 = 0, $350 = 0, $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0, $358 = 0.0, $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0.0, $363 = 0, $364 = 0, $365 = 0;
 var $366 = 0, $367 = 0, $368 = 0, $369 = 0, $37 = 0, $370 = 0, $371 = 0, $372 = 0, $373 = 0, $374 = 0, $375 = 0, $376 = 0, $377 = 0, $378 = 0, $379 = 0, $38 = 0, $380 = 0, $381 = 0, $382 = 0, $383 = 0;
 var $384 = 0, $385 = 0, $386 = 0, $387 = 0, $388 = 0, $389 = 0, $39 = 0, $390 = 0.0, $391 = 0.0, $392 = 0, $393 = 0, $394 = 0, $395 = 0, $396 = 0, $397 = 0, $398 = 0, $399 = 0, $4 = 0, $40 = 0, $400 = 0;
 var $401 = 0, $402 = 0, $403 = 0, $404 = 0, $405 = 0, $406 = 0.0, $407 = 0, $408 = 0, $409 = 0, $41 = 0, $410 = 0.0, $411 = 0.0, $412 = 0.0, $413 = 0.0, $414 = 0.0, $415 = 0.0, $416 = 0, $417 = 0, $418 = 0, $419 = 0;
 var $42 = 0, $420 = 0, $421 = 0, $422 = 0, $423 = 0, $424 = 0, $425 = 0, $426 = 0, $427 = 0, $428 = 0, $429 = 0, $43 = 0, $430 = 0, $431 = 0, $432 = 0, $433 = 0, $434 = 0, $435 = 0, $436 = 0, $437 = 0;
 var $438 = 0, $439 = 0, $44 = 0, $440 = 0, $441 = 0.0, $442 = 0.0, $443 = 0.0, $444 = 0, $445 = 0, $446 = 0, $447 = 0, $448 = 0, $449 = 0, $45 = 0, $450 = 0, $451 = 0, $452 = 0, $453 = 0, $454 = 0, $455 = 0;
 var $456 = 0, $457 = 0, $458 = 0, $459 = 0, $46 = 0, $460 = 0, $461 = 0, $462 = 0, $463 = 0, $464 = 0, $465 = 0, $466 = 0, $467 = 0, $468 = 0, $469 = 0, $47 = 0, $470 = 0, $471 = 0, $472 = 0, $473 = 0;
 var $474 = 0.0, $475 = 0, $476 = 0, $477 = 0, $478 = 0, $479 = 0, $48 = 0, $480 = 0, $481 = 0, $482 = 0.0, $483 = 0.0, $484 = 0.0, $485 = 0, $486 = 0, $487 = 0, $488 = 0, $489 = 0, $49 = 0, $490 = 0, $491 = 0;
 var $492 = 0, $493 = 0, $494 = 0, $495 = 0, $496 = 0, $497 = 0, $498 = 0, $499 = 0, $5 = 0, $50 = 0, $500 = 0, $501 = 0, $502 = 0, $503 = 0, $504 = 0, $505 = 0, $506 = 0, $507 = 0, $508 = 0, $509 = 0;
 var $51 = 0, $510 = 0, $511 = 0, $512 = 0, $513 = 0, $514 = 0, $515 = 0, $516 = 0, $517 = 0, $518 = 0, $519 = 0, $52 = 0, $520 = 0, $521 = 0, $522 = 0, $523 = 0, $524 = 0, $525 = 0, $526 = 0, $527 = 0;
 var $528 = 0, $529 = 0, $53 = 0, $530 = 0, $531 = 0, $532 = 0, $533 = 0, $534 = 0, $535 = 0, $536 = 0, $537 = 0, $538 = 0, $539 = 0, $54 = 0, $540 = 0, $541 = 0, $542 = 0, $543 = 0, $544 = 0, $545 = 0;
 var $546 = 0, $547 = 0, $548 = 0, $549 = 0, $55 = 0, $550 = 0, $551 = 0, $552 = 0, $553 = 0, $554 = 0, $555 = 0, $556 = 0, $557 = 0, $558 = 0, $559 = 0, $56 = 0, $560 = 0, $561 = 0, $562 = 0, $563 = 0;
 var $564 = 0, $565 = 0, $566 = 0, $567 = 0, $568 = 0, $569 = 0, $57 = 0, $570 = 0, $571 = 0, $572 = 0, $573 = 0, $574 = 0, $575 = 0, $576 = 0, $577 = 0, $578 = 0, $579 = 0, $58 = 0, $580 = 0, $581 = 0;
 var $582 = 0, $583 = 0, $584 = 0, $585 = 0, $586 = 0, $587 = 0, $588 = 0, $589 = 0, $59 = 0, $590 = 0, $591 = 0, $592 = 0, $593 = 0.0, $594 = 0.0, $595 = 0, $596 = 0.0, $597 = 0, $598 = 0, $599 = 0, $6 = 0;
 var $60 = 0, $600 = 0, $601 = 0, $602 = 0, $603 = 0, $604 = 0, $605 = 0, $606 = 0, $607 = 0, $608 = 0, $609 = 0, $61 = 0, $610 = 0, $611 = 0, $612 = 0, $613 = 0, $614 = 0, $615 = 0, $616 = 0, $617 = 0;
 var $618 = 0, $619 = 0, $62 = 0, $620 = 0, $621 = 0, $622 = 0, $623 = 0, $624 = 0, $625 = 0, $626 = 0, $627 = 0, $628 = 0, $629 = 0, $63 = 0, $630 = 0, $631 = 0, $632 = 0, $633 = 0, $634 = 0, $635 = 0;
 var $636 = 0, $637 = 0, $638 = 0, $639 = 0, $64 = 0, $640 = 0, $641 = 0, $642 = 0, $643 = 0, $644 = 0, $645 = 0, $646 = 0, $647 = 0, $648 = 0, $649 = 0, $65 = 0, $650 = 0, $651 = 0, $652 = 0, $653 = 0;
 var $654 = 0, $655 = 0, $656 = 0, $657 = 0, $658 = 0, $659 = 0, $66 = 0, $660 = 0, $661 = 0, $662 = 0, $663 = 0, $664 = 0, $665 = 0, $666 = 0, $667 = 0, $668 = 0, $669 = 0, $67 = 0, $670 = 0, $671 = 0;
 var $672 = 0, $673 = 0, $674 = 0, $675 = 0, $676 = 0, $677 = 0, $678 = 0, $679 = 0, $68 = 0, $680 = 0, $681 = 0, $682 = 0, $683 = 0, $684 = 0, $685 = 0, $686 = 0, $687 = 0, $688 = 0, $689 = 0, $69 = 0;
 var $690 = 0, $691 = 0, $692 = 0, $693 = 0, $694 = 0, $695 = 0, $696 = 0, $697 = 0, $698 = 0, $699 = 0, $7 = 0, $70 = 0, $700 = 0, $701 = 0, $702 = 0, $703 = 0, $704 = 0, $705 = 0, $706 = 0, $707 = 0;
 var $708 = 0, $709 = 0, $71 = 0, $710 = 0, $711 = 0, $712 = 0, $713 = 0, $714 = 0, $715 = 0, $716 = 0, $717 = 0, $718 = 0, $719 = 0, $72 = 0, $720 = 0, $721 = 0, $722 = 0, $723 = 0, $724 = 0, $725 = 0;
 var $726 = 0, $727 = 0, $728 = 0, $729 = 0, $73 = 0, $730 = 0, $731 = 0, $732 = 0, $733 = 0, $734 = 0, $735 = 0, $736 = 0, $737 = 0, $738 = 0, $739 = 0, $74 = 0, $740 = 0, $741 = 0, $742 = 0, $743 = 0;
 var $744 = 0, $745 = 0, $746 = 0, $747 = 0, $748 = 0, $749 = 0, $75 = 0, $750 = 0, $751 = 0, $752 = 0, $753 = 0, $754 = 0, $755 = 0, $756 = 0, $757 = 0, $758 = 0, $759 = 0, $76 = 0, $760 = 0, $761 = 0;
 var $762 = 0, $763 = 0, $764 = 0, $765 = 0, $766 = 0, $767 = 0, $768 = 0, $769 = 0, $77 = 0, $770 = 0, $771 = 0, $772 = 0, $773 = 0, $774 = 0, $775 = 0, $776 = 0, $777 = 0, $778 = 0, $779 = 0, $78 = 0;
 var $780 = 0, $781 = 0, $782 = 0, $783 = 0, $784 = 0, $785 = 0, $786 = 0, $787 = 0, $788 = 0, $789 = 0, $79 = 0, $790 = 0, $791 = 0, $792 = 0, $793 = 0, $794 = 0, $795 = 0, $796 = 0, $797 = 0, $798 = 0;
 var $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0;
 var $98 = 0, $99 = 0, $a$0 = 0, $a$1 = 0, $a$1$lcssa$i = 0, $a$1149$i = 0, $a$2 = 0, $a$2$ph$i = 0, $a$3$lcssa$i = 0, $a$3136$i = 0, $a$5$lcssa$i = 0, $a$5111$i = 0, $a$6$i = 0, $a$8$i = 0, $a$9$ph$i = 0, $arg = 0, $arglist_current = 0, $arglist_current2 = 0, $arglist_next = 0, $arglist_next3 = 0;
 var $argpos$0 = 0, $big$i = 0, $buf = 0, $buf$i = 0, $carry$0142$i = 0, $carry3$0130$i = 0, $cnt$0 = 0, $cnt$1 = 0, $cnt$1$lcssa = 0, $d$0$i = 0, $d$0141$i = 0, $d$0143$i = 0, $d$1129$i = 0, $d$2$lcssa$i = 0, $d$2110$i = 0, $d$4$i = 0, $d$584$i = 0, $d$677$i = 0, $d$788$i = 0, $e$0125$i = 0;
 var $e$1$i = 0, $e$2106$i = 0, $e$4$i = 0, $e$5$ph$i = 0, $e2$i = 0, $ebuf0$i = 0, $estr$0$i = 0, $estr$1$lcssa$i = 0, $estr$195$i = 0, $estr$2$i = 0, $exitcond$i = 0, $expanded = 0, $expanded10 = 0, $expanded11 = 0, $expanded13 = 0, $expanded14 = 0, $expanded15 = 0, $expanded4 = 0, $expanded6 = 0, $expanded7 = 0;
 var $expanded8 = 0, $fl$0100 = 0, $fl$053 = 0, $fl$1 = 0, $fl$1$ = 0, $fl$3 = 0, $fl$4 = 0, $fl$6 = 0, $i$0$lcssa = 0, $i$0$lcssa178 = 0, $i$0105 = 0, $i$0124$i = 0, $i$03$i = 0, $i$03$i25 = 0, $i$1$lcssa$i = 0, $i$1116 = 0, $i$1118$i = 0, $i$2105$i = 0, $i$291 = 0, $i$291$lcssa = 0;
 var $i$3101$i = 0, $i$389 = 0, $isdigit = 0, $isdigit$i = 0, $isdigit$i27 = 0, $isdigit10 = 0, $isdigit12 = 0, $isdigit2$i = 0, $isdigit2$i23 = 0, $isdigittmp = 0, $isdigittmp$ = 0, $isdigittmp$i = 0, $isdigittmp$i26 = 0, $isdigittmp1$i = 0, $isdigittmp1$i22 = 0, $isdigittmp11 = 0, $isdigittmp4$i = 0, $isdigittmp4$i24 = 0, $isdigittmp9 = 0, $j$0$i = 0;
 var $j$0117$i = 0, $j$0119$i = 0, $j$1102$i = 0, $j$2$i = 0, $l$0 = 0, $l$0$i = 0, $l$1$i = 0, $l$1104 = 0, $l$2 = 0, $l10n$0 = 0, $l10n$0$lcssa = 0, $l10n$0$phi = 0, $l10n$1 = 0, $l10n$2 = 0, $l10n$3 = 0, $mb = 0, $notlhs$i = 0, $notrhs$i = 0, $or$cond = 0, $or$cond$i = 0;
 var $or$cond122 = 0, $or$cond15 = 0, $or$cond17 = 0, $or$cond18$i = 0, $or$cond20 = 0, $or$cond22$i = 0, $or$cond3$not$i = 0, $or$cond31$i = 0, $or$cond6$i = 0, $p$0 = 0, $p$0$ = 0, $p$1 = 0, $p$2 = 0, $p$2$ = 0, $p$3 = 0, $p$4176 = 0, $p$5 = 0, $pl$0 = 0, $pl$0$i = 0, $pl$1 = 0;
 var $pl$1$i = 0, $pl$2 = 0, $prefix$0 = 0, $prefix$0$$i = 0, $prefix$0$i = 0, $prefix$1 = 0, $prefix$2 = 0, $r$0$a$9$i = 0, $re$171$i = 0, $round$070$i = 0.0, $round6$1$i = 0.0, $s$0 = 0, $s$0$i = 0, $s$1 = 0, $s$1$i = 0, $s$1$i$lcssa = 0, $s$2$lcssa = 0, $s$292 = 0, $s$4 = 0, $s$6 = 0;
 var $s$7 = 0, $s$7$lcssa298 = 0, $s1$0$i = 0, $s7$081$i = 0, $s7$1$i = 0, $s8$0$lcssa$i = 0, $s8$072$i = 0, $s9$0$i = 0, $s9$185$i = 0, $s9$2$i = 0, $scevgep182$i = 0, $scevgep182183$i = 0, $small$0$i = 0.0, $small$1$i = 0.0, $st$0 = 0, $st$0$lcssa299 = 0, $storemerge = 0, $storemerge13 = 0, $storemerge851 = 0, $storemerge899 = 0;
 var $sum = 0, $t$0 = 0, $t$1 = 0, $w$$i = 0, $w$0 = 0, $w$1 = 0, $w$2 = 0, $w$32$i = 0, $wc = 0, $ws$0106 = 0, $ws$1117 = 0, $z$0$i = 0, $z$0$lcssa = 0, $z$093 = 0, $z$1 = 0, $z$1$lcssa$i = 0, $z$1148$i = 0, $z$2 = 0, $z$2$i = 0, $z$2$i$lcssa = 0;
 var $z$3$lcssa$i = 0, $z$3135$i = 0, $z$4$i = 0, $z$7$$i = 0, $z$7$i = 0, $z$7$i$lcssa = 0, $z$7$ph$i = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 624|0;
 $big$i = sp + 24|0;
 $e2$i = sp + 16|0;
 $buf$i = sp + 588|0;
 $ebuf0$i = sp + 576|0;
 $arg = sp;
 $buf = sp + 536|0;
 $wc = sp + 8|0;
 $mb = sp + 528|0;
 $0 = ($f|0)!=(0|0);
 $1 = ((($buf)) + 40|0);
 $2 = $1;
 $3 = ((($buf)) + 39|0);
 $4 = ((($wc)) + 4|0);
 $5 = $buf$i;
 $6 = (0 - ($5))|0;
 $7 = ((($ebuf0$i)) + 12|0);
 $8 = ((($ebuf0$i)) + 11|0);
 $9 = $7;
 $10 = (($9) - ($5))|0;
 $11 = (-2 - ($5))|0;
 $12 = (($9) + 2)|0;
 $13 = ((($big$i)) + 288|0);
 $14 = ((($buf$i)) + 9|0);
 $15 = $14;
 $16 = ((($buf$i)) + 8|0);
 $cnt$0 = 0;$l$0 = 0;$l10n$0 = 0;$s$0 = $fmt;
 L1: while(1) {
  $17 = ($cnt$0|0)>(-1);
  do {
   if ($17) {
    $18 = (2147483647 - ($cnt$0))|0;
    $19 = ($l$0|0)>($18|0);
    if ($19) {
     $20 = (___errno_location()|0);
     HEAP32[$20>>2] = 75;
     $cnt$1 = -1;
     break;
    } else {
     $21 = (($l$0) + ($cnt$0))|0;
     $cnt$1 = $21;
     break;
    }
   } else {
    $cnt$1 = $cnt$0;
   }
  } while(0);
  $22 = HEAP8[$s$0>>0]|0;
  $23 = ($22<<24>>24)==(0);
  if ($23) {
   $cnt$1$lcssa = $cnt$1;$l10n$0$lcssa = $l10n$0;
   label = 244;
   break;
  } else {
   $24 = $22;$s$1 = $s$0;
  }
  L9: while(1) {
   switch ($24<<24>>24) {
   case 37:  {
    $s$292 = $s$1;$z$093 = $s$1;
    label = 9;
    break L9;
    break;
   }
   case 0:  {
    $s$2$lcssa = $s$1;$z$0$lcssa = $s$1;
    break L9;
    break;
   }
   default: {
   }
   }
   $25 = ((($s$1)) + 1|0);
   $$pre = HEAP8[$25>>0]|0;
   $24 = $$pre;$s$1 = $25;
  }
  L12: do {
   if ((label|0) == 9) {
    while(1) {
     label = 0;
     $26 = ((($s$292)) + 1|0);
     $27 = HEAP8[$26>>0]|0;
     $28 = ($27<<24>>24)==(37);
     if (!($28)) {
      $s$2$lcssa = $s$292;$z$0$lcssa = $z$093;
      break L12;
     }
     $29 = ((($z$093)) + 1|0);
     $30 = ((($s$292)) + 2|0);
     $31 = HEAP8[$30>>0]|0;
     $32 = ($31<<24>>24)==(37);
     if ($32) {
      $s$292 = $30;$z$093 = $29;
      label = 9;
     } else {
      $s$2$lcssa = $30;$z$0$lcssa = $29;
      break;
     }
    }
   }
  } while(0);
  $33 = $z$0$lcssa;
  $34 = $s$0;
  $35 = (($33) - ($34))|0;
  if ($0) {
   $36 = HEAP32[$f>>2]|0;
   $37 = $36 & 32;
   $38 = ($37|0)==(0);
   if ($38) {
    (___fwritex($s$0,$35,$f)|0);
   }
  }
  $39 = ($z$0$lcssa|0)==($s$0|0);
  if (!($39)) {
   $l10n$0$phi = $l10n$0;$cnt$0 = $cnt$1;$l$0 = $35;$s$0 = $s$2$lcssa;$l10n$0 = $l10n$0$phi;
   continue;
  }
  $40 = ((($s$2$lcssa)) + 1|0);
  $41 = HEAP8[$40>>0]|0;
  $42 = $41 << 24 >> 24;
  $isdigittmp = (($42) + -48)|0;
  $isdigit = ($isdigittmp>>>0)<(10);
  if ($isdigit) {
   $43 = ((($s$2$lcssa)) + 2|0);
   $44 = HEAP8[$43>>0]|0;
   $45 = ($44<<24>>24)==(36);
   $46 = ((($s$2$lcssa)) + 3|0);
   $$43 = $45 ? $46 : $40;
   $$l10n$0 = $45 ? 1 : $l10n$0;
   $isdigittmp$ = $45 ? $isdigittmp : -1;
   $$pre170 = HEAP8[$$43>>0]|0;
   $48 = $$pre170;$argpos$0 = $isdigittmp$;$l10n$1 = $$l10n$0;$storemerge = $$43;
  } else {
   $48 = $41;$argpos$0 = -1;$l10n$1 = $l10n$0;$storemerge = $40;
  }
  $47 = $48 << 24 >> 24;
  $49 = $47 & -32;
  $50 = ($49|0)==(32);
  L25: do {
   if ($50) {
    $52 = $47;$57 = $48;$fl$0100 = 0;$storemerge899 = $storemerge;
    while(1) {
     $51 = (($52) + -32)|0;
     $53 = 1 << $51;
     $54 = $53 & 75913;
     $55 = ($54|0)==(0);
     if ($55) {
      $67 = $57;$fl$053 = $fl$0100;$storemerge851 = $storemerge899;
      break L25;
     }
     $56 = $57 << 24 >> 24;
     $58 = (($56) + -32)|0;
     $59 = 1 << $58;
     $60 = $59 | $fl$0100;
     $61 = ((($storemerge899)) + 1|0);
     $62 = HEAP8[$61>>0]|0;
     $63 = $62 << 24 >> 24;
     $64 = $63 & -32;
     $65 = ($64|0)==(32);
     if ($65) {
      $52 = $63;$57 = $62;$fl$0100 = $60;$storemerge899 = $61;
     } else {
      $67 = $62;$fl$053 = $60;$storemerge851 = $61;
      break;
     }
    }
   } else {
    $67 = $48;$fl$053 = 0;$storemerge851 = $storemerge;
   }
  } while(0);
  $66 = ($67<<24>>24)==(42);
  do {
   if ($66) {
    $68 = ((($storemerge851)) + 1|0);
    $69 = HEAP8[$68>>0]|0;
    $70 = $69 << 24 >> 24;
    $isdigittmp11 = (($70) + -48)|0;
    $isdigit12 = ($isdigittmp11>>>0)<(10);
    if ($isdigit12) {
     $71 = ((($storemerge851)) + 2|0);
     $72 = HEAP8[$71>>0]|0;
     $73 = ($72<<24>>24)==(36);
     if ($73) {
      $74 = (($nl_type) + ($isdigittmp11<<2)|0);
      HEAP32[$74>>2] = 10;
      $75 = HEAP8[$68>>0]|0;
      $76 = $75 << 24 >> 24;
      $77 = (($76) + -48)|0;
      $78 = (($nl_arg) + ($77<<3)|0);
      $79 = $78;
      $80 = $79;
      $81 = HEAP32[$80>>2]|0;
      $82 = (($79) + 4)|0;
      $83 = $82;
      $84 = HEAP32[$83>>2]|0;
      $85 = ((($storemerge851)) + 3|0);
      $l10n$2 = 1;$storemerge13 = $85;$w$0 = $81;
     } else {
      label = 24;
     }
    } else {
     label = 24;
    }
    if ((label|0) == 24) {
     label = 0;
     $86 = ($l10n$1|0)==(0);
     if (!($86)) {
      $$0 = -1;
      break L1;
     }
     if (!($0)) {
      $fl$1 = $fl$053;$l10n$3 = 0;$s$4 = $68;$w$1 = 0;
      break;
     }
     $arglist_current = HEAP32[$ap>>2]|0;
     $87 = $arglist_current;
     $88 = ((0) + 4|0);
     $expanded4 = $88;
     $expanded = (($expanded4) - 1)|0;
     $89 = (($87) + ($expanded))|0;
     $90 = ((0) + 4|0);
     $expanded8 = $90;
     $expanded7 = (($expanded8) - 1)|0;
     $expanded6 = $expanded7 ^ -1;
     $91 = $89 & $expanded6;
     $92 = $91;
     $93 = HEAP32[$92>>2]|0;
     $arglist_next = ((($92)) + 4|0);
     HEAP32[$ap>>2] = $arglist_next;
     $l10n$2 = 0;$storemerge13 = $68;$w$0 = $93;
    }
    $94 = ($w$0|0)<(0);
    if ($94) {
     $95 = $fl$053 | 8192;
     $96 = (0 - ($w$0))|0;
     $fl$1 = $95;$l10n$3 = $l10n$2;$s$4 = $storemerge13;$w$1 = $96;
    } else {
     $fl$1 = $fl$053;$l10n$3 = $l10n$2;$s$4 = $storemerge13;$w$1 = $w$0;
    }
   } else {
    $97 = $67 << 24 >> 24;
    $isdigittmp1$i = (($97) + -48)|0;
    $isdigit2$i = ($isdigittmp1$i>>>0)<(10);
    if ($isdigit2$i) {
     $101 = $storemerge851;$i$03$i = 0;$isdigittmp4$i = $isdigittmp1$i;
     while(1) {
      $98 = ($i$03$i*10)|0;
      $99 = (($98) + ($isdigittmp4$i))|0;
      $100 = ((($101)) + 1|0);
      $102 = HEAP8[$100>>0]|0;
      $103 = $102 << 24 >> 24;
      $isdigittmp$i = (($103) + -48)|0;
      $isdigit$i = ($isdigittmp$i>>>0)<(10);
      if ($isdigit$i) {
       $101 = $100;$i$03$i = $99;$isdigittmp4$i = $isdigittmp$i;
      } else {
       $$lcssa = $99;$$lcssa295 = $100;
       break;
      }
     }
     $104 = ($$lcssa|0)<(0);
     if ($104) {
      $$0 = -1;
      break L1;
     } else {
      $fl$1 = $fl$053;$l10n$3 = $l10n$1;$s$4 = $$lcssa295;$w$1 = $$lcssa;
     }
    } else {
     $fl$1 = $fl$053;$l10n$3 = $l10n$1;$s$4 = $storemerge851;$w$1 = 0;
    }
   }
  } while(0);
  $105 = HEAP8[$s$4>>0]|0;
  $106 = ($105<<24>>24)==(46);
  L46: do {
   if ($106) {
    $107 = ((($s$4)) + 1|0);
    $108 = HEAP8[$107>>0]|0;
    $109 = ($108<<24>>24)==(42);
    if (!($109)) {
     $136 = $108 << 24 >> 24;
     $isdigittmp1$i22 = (($136) + -48)|0;
     $isdigit2$i23 = ($isdigittmp1$i22>>>0)<(10);
     if ($isdigit2$i23) {
      $140 = $107;$i$03$i25 = 0;$isdigittmp4$i24 = $isdigittmp1$i22;
     } else {
      $p$0 = 0;$s$6 = $107;
      break;
     }
     while(1) {
      $137 = ($i$03$i25*10)|0;
      $138 = (($137) + ($isdigittmp4$i24))|0;
      $139 = ((($140)) + 1|0);
      $141 = HEAP8[$139>>0]|0;
      $142 = $141 << 24 >> 24;
      $isdigittmp$i26 = (($142) + -48)|0;
      $isdigit$i27 = ($isdigittmp$i26>>>0)<(10);
      if ($isdigit$i27) {
       $140 = $139;$i$03$i25 = $138;$isdigittmp4$i24 = $isdigittmp$i26;
      } else {
       $p$0 = $138;$s$6 = $139;
       break L46;
      }
     }
    }
    $110 = ((($s$4)) + 2|0);
    $111 = HEAP8[$110>>0]|0;
    $112 = $111 << 24 >> 24;
    $isdigittmp9 = (($112) + -48)|0;
    $isdigit10 = ($isdigittmp9>>>0)<(10);
    if ($isdigit10) {
     $113 = ((($s$4)) + 3|0);
     $114 = HEAP8[$113>>0]|0;
     $115 = ($114<<24>>24)==(36);
     if ($115) {
      $116 = (($nl_type) + ($isdigittmp9<<2)|0);
      HEAP32[$116>>2] = 10;
      $117 = HEAP8[$110>>0]|0;
      $118 = $117 << 24 >> 24;
      $119 = (($118) + -48)|0;
      $120 = (($nl_arg) + ($119<<3)|0);
      $121 = $120;
      $122 = $121;
      $123 = HEAP32[$122>>2]|0;
      $124 = (($121) + 4)|0;
      $125 = $124;
      $126 = HEAP32[$125>>2]|0;
      $127 = ((($s$4)) + 4|0);
      $p$0 = $123;$s$6 = $127;
      break;
     }
    }
    $128 = ($l10n$3|0)==(0);
    if (!($128)) {
     $$0 = -1;
     break L1;
    }
    if ($0) {
     $arglist_current2 = HEAP32[$ap>>2]|0;
     $129 = $arglist_current2;
     $130 = ((0) + 4|0);
     $expanded11 = $130;
     $expanded10 = (($expanded11) - 1)|0;
     $131 = (($129) + ($expanded10))|0;
     $132 = ((0) + 4|0);
     $expanded15 = $132;
     $expanded14 = (($expanded15) - 1)|0;
     $expanded13 = $expanded14 ^ -1;
     $133 = $131 & $expanded13;
     $134 = $133;
     $135 = HEAP32[$134>>2]|0;
     $arglist_next3 = ((($134)) + 4|0);
     HEAP32[$ap>>2] = $arglist_next3;
     $p$0 = $135;$s$6 = $110;
    } else {
     $p$0 = 0;$s$6 = $110;
    }
   } else {
    $p$0 = -1;$s$6 = $s$4;
   }
  } while(0);
  $s$7 = $s$6;$st$0 = 0;
  while(1) {
   $143 = HEAP8[$s$7>>0]|0;
   $144 = $143 << 24 >> 24;
   $145 = (($144) + -65)|0;
   $146 = ($145>>>0)>(57);
   if ($146) {
    $$0 = -1;
    break L1;
   }
   $147 = ((($s$7)) + 1|0);
   $148 = ((862 + (($st$0*58)|0)|0) + ($145)|0);
   $149 = HEAP8[$148>>0]|0;
   $150 = $149&255;
   $151 = (($150) + -1)|0;
   $152 = ($151>>>0)<(8);
   if ($152) {
    $s$7 = $147;$st$0 = $150;
   } else {
    $$lcssa300 = $147;$$lcssa301 = $149;$$lcssa302 = $150;$s$7$lcssa298 = $s$7;$st$0$lcssa299 = $st$0;
    break;
   }
  }
  $153 = ($$lcssa301<<24>>24)==(0);
  if ($153) {
   $$0 = -1;
   break;
  }
  $154 = ($$lcssa301<<24>>24)==(19);
  $155 = ($argpos$0|0)>(-1);
  do {
   if ($154) {
    if ($155) {
     $$0 = -1;
     break L1;
    } else {
     label = 52;
    }
   } else {
    if ($155) {
     $156 = (($nl_type) + ($argpos$0<<2)|0);
     HEAP32[$156>>2] = $$lcssa302;
     $157 = (($nl_arg) + ($argpos$0<<3)|0);
     $158 = $157;
     $159 = $158;
     $160 = HEAP32[$159>>2]|0;
     $161 = (($158) + 4)|0;
     $162 = $161;
     $163 = HEAP32[$162>>2]|0;
     $164 = $arg;
     $165 = $164;
     HEAP32[$165>>2] = $160;
     $166 = (($164) + 4)|0;
     $167 = $166;
     HEAP32[$167>>2] = $163;
     label = 52;
     break;
    }
    if (!($0)) {
     $$0 = 0;
     break L1;
    }
    _pop_arg($arg,$$lcssa302,$ap);
   }
  } while(0);
  if ((label|0) == 52) {
   label = 0;
   if (!($0)) {
    $cnt$0 = $cnt$1;$l$0 = $35;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
    continue;
   }
  }
  $168 = HEAP8[$s$7$lcssa298>>0]|0;
  $169 = $168 << 24 >> 24;
  $170 = ($st$0$lcssa299|0)!=(0);
  $171 = $169 & 15;
  $172 = ($171|0)==(3);
  $or$cond15 = $170 & $172;
  $173 = $169 & -33;
  $t$0 = $or$cond15 ? $173 : $169;
  $174 = $fl$1 & 8192;
  $175 = ($174|0)==(0);
  $176 = $fl$1 & -65537;
  $fl$1$ = $175 ? $fl$1 : $176;
  L75: do {
   switch ($t$0|0) {
   case 110:  {
    switch ($st$0$lcssa299|0) {
    case 0:  {
     $183 = HEAP32[$arg>>2]|0;
     HEAP32[$183>>2] = $cnt$1;
     $cnt$0 = $cnt$1;$l$0 = $35;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
     continue L1;
     break;
    }
    case 1:  {
     $184 = HEAP32[$arg>>2]|0;
     HEAP32[$184>>2] = $cnt$1;
     $cnt$0 = $cnt$1;$l$0 = $35;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
     continue L1;
     break;
    }
    case 2:  {
     $185 = ($cnt$1|0)<(0);
     $186 = $185 << 31 >> 31;
     $187 = HEAP32[$arg>>2]|0;
     $188 = $187;
     $189 = $188;
     HEAP32[$189>>2] = $cnt$1;
     $190 = (($188) + 4)|0;
     $191 = $190;
     HEAP32[$191>>2] = $186;
     $cnt$0 = $cnt$1;$l$0 = $35;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
     continue L1;
     break;
    }
    case 3:  {
     $192 = $cnt$1&65535;
     $193 = HEAP32[$arg>>2]|0;
     HEAP16[$193>>1] = $192;
     $cnt$0 = $cnt$1;$l$0 = $35;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
     continue L1;
     break;
    }
    case 4:  {
     $194 = $cnt$1&255;
     $195 = HEAP32[$arg>>2]|0;
     HEAP8[$195>>0] = $194;
     $cnt$0 = $cnt$1;$l$0 = $35;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
     continue L1;
     break;
    }
    case 6:  {
     $196 = HEAP32[$arg>>2]|0;
     HEAP32[$196>>2] = $cnt$1;
     $cnt$0 = $cnt$1;$l$0 = $35;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
     continue L1;
     break;
    }
    case 7:  {
     $197 = ($cnt$1|0)<(0);
     $198 = $197 << 31 >> 31;
     $199 = HEAP32[$arg>>2]|0;
     $200 = $199;
     $201 = $200;
     HEAP32[$201>>2] = $cnt$1;
     $202 = (($200) + 4)|0;
     $203 = $202;
     HEAP32[$203>>2] = $198;
     $cnt$0 = $cnt$1;$l$0 = $35;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
     continue L1;
     break;
    }
    default: {
     $cnt$0 = $cnt$1;$l$0 = $35;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
     continue L1;
    }
    }
    break;
   }
   case 112:  {
    $204 = ($p$0>>>0)>(8);
    $205 = $204 ? $p$0 : 8;
    $206 = $fl$1$ | 8;
    $fl$3 = $206;$p$1 = $205;$t$1 = 120;
    label = 64;
    break;
   }
   case 88: case 120:  {
    $fl$3 = $fl$1$;$p$1 = $p$0;$t$1 = $t$0;
    label = 64;
    break;
   }
   case 111:  {
    $244 = $arg;
    $245 = $244;
    $246 = HEAP32[$245>>2]|0;
    $247 = (($244) + 4)|0;
    $248 = $247;
    $249 = HEAP32[$248>>2]|0;
    $250 = ($246|0)==(0);
    $251 = ($249|0)==(0);
    $252 = $250 & $251;
    if ($252) {
     $$0$lcssa$i = $1;
    } else {
     $$03$i33 = $1;$254 = $246;$258 = $249;
     while(1) {
      $253 = $254 & 7;
      $255 = $253 | 48;
      $256 = $255&255;
      $257 = ((($$03$i33)) + -1|0);
      HEAP8[$257>>0] = $256;
      $259 = (_bitshift64Lshr(($254|0),($258|0),3)|0);
      $260 = tempRet0;
      $261 = ($259|0)==(0);
      $262 = ($260|0)==(0);
      $263 = $261 & $262;
      if ($263) {
       $$0$lcssa$i = $257;
       break;
      } else {
       $$03$i33 = $257;$254 = $259;$258 = $260;
      }
     }
    }
    $264 = $fl$1$ & 8;
    $265 = ($264|0)==(0);
    if ($265) {
     $a$0 = $$0$lcssa$i;$fl$4 = $fl$1$;$p$2 = $p$0;$pl$1 = 0;$prefix$1 = 1342;
     label = 77;
    } else {
     $266 = $$0$lcssa$i;
     $267 = (($2) - ($266))|0;
     $268 = ($p$0|0)>($267|0);
     $269 = (($267) + 1)|0;
     $p$0$ = $268 ? $p$0 : $269;
     $a$0 = $$0$lcssa$i;$fl$4 = $fl$1$;$p$2 = $p$0$;$pl$1 = 0;$prefix$1 = 1342;
     label = 77;
    }
    break;
   }
   case 105: case 100:  {
    $270 = $arg;
    $271 = $270;
    $272 = HEAP32[$271>>2]|0;
    $273 = (($270) + 4)|0;
    $274 = $273;
    $275 = HEAP32[$274>>2]|0;
    $276 = ($275|0)<(0);
    if ($276) {
     $277 = (_i64Subtract(0,0,($272|0),($275|0))|0);
     $278 = tempRet0;
     $279 = $arg;
     $280 = $279;
     HEAP32[$280>>2] = $277;
     $281 = (($279) + 4)|0;
     $282 = $281;
     HEAP32[$282>>2] = $278;
     $287 = $277;$288 = $278;$pl$0 = 1;$prefix$0 = 1342;
     label = 76;
     break L75;
    }
    $283 = $fl$1$ & 2048;
    $284 = ($283|0)==(0);
    if ($284) {
     $285 = $fl$1$ & 1;
     $286 = ($285|0)==(0);
     $$ = $286 ? 1342 : (1344);
     $287 = $272;$288 = $275;$pl$0 = $285;$prefix$0 = $$;
     label = 76;
    } else {
     $287 = $272;$288 = $275;$pl$0 = 1;$prefix$0 = (1343);
     label = 76;
    }
    break;
   }
   case 117:  {
    $177 = $arg;
    $178 = $177;
    $179 = HEAP32[$178>>2]|0;
    $180 = (($177) + 4)|0;
    $181 = $180;
    $182 = HEAP32[$181>>2]|0;
    $287 = $179;$288 = $182;$pl$0 = 0;$prefix$0 = 1342;
    label = 76;
    break;
   }
   case 99:  {
    $308 = $arg;
    $309 = $308;
    $310 = HEAP32[$309>>2]|0;
    $311 = (($308) + 4)|0;
    $312 = $311;
    $313 = HEAP32[$312>>2]|0;
    $314 = $310&255;
    HEAP8[$3>>0] = $314;
    $a$2 = $3;$fl$6 = $176;$p$5 = 1;$pl$2 = 0;$prefix$2 = 1342;$z$2 = $1;
    break;
   }
   case 109:  {
    $315 = (___errno_location()|0);
    $316 = HEAP32[$315>>2]|0;
    $317 = (_strerror($316)|0);
    $a$1 = $317;
    label = 82;
    break;
   }
   case 115:  {
    $318 = HEAP32[$arg>>2]|0;
    $319 = ($318|0)!=(0|0);
    $320 = $319 ? $318 : 3244;
    $a$1 = $320;
    label = 82;
    break;
   }
   case 67:  {
    $327 = $arg;
    $328 = $327;
    $329 = HEAP32[$328>>2]|0;
    $330 = (($327) + 4)|0;
    $331 = $330;
    $332 = HEAP32[$331>>2]|0;
    HEAP32[$wc>>2] = $329;
    HEAP32[$4>>2] = 0;
    HEAP32[$arg>>2] = $wc;
    $798 = $wc;$p$4176 = -1;
    label = 86;
    break;
   }
   case 83:  {
    $$pre171 = HEAP32[$arg>>2]|0;
    $333 = ($p$0|0)==(0);
    if ($333) {
     _pad($f,32,$w$1,0,$fl$1$);
     $i$0$lcssa178 = 0;
     label = 97;
    } else {
     $798 = $$pre171;$p$4176 = $p$0;
     label = 86;
    }
    break;
   }
   case 65: case 71: case 70: case 69: case 97: case 103: case 102: case 101:  {
    $358 = +HEAPF64[$arg>>3];
    HEAP32[$e2$i>>2] = 0;
    HEAPF64[tempDoublePtr>>3] = $358;$359 = HEAP32[tempDoublePtr>>2]|0;
    $360 = HEAP32[tempDoublePtr+4>>2]|0;
    $361 = ($360|0)<(0);
    if ($361) {
     $362 = -$358;
     $$07$i = $362;$pl$0$i = 1;$prefix$0$i = 3251;
    } else {
     $363 = $fl$1$ & 2048;
     $364 = ($363|0)==(0);
     if ($364) {
      $365 = $fl$1$ & 1;
      $366 = ($365|0)==(0);
      $$$i = $366 ? (3252) : (3257);
      $$07$i = $358;$pl$0$i = $365;$prefix$0$i = $$$i;
     } else {
      $$07$i = $358;$pl$0$i = 1;$prefix$0$i = (3254);
     }
    }
    HEAPF64[tempDoublePtr>>3] = $$07$i;$367 = HEAP32[tempDoublePtr>>2]|0;
    $368 = HEAP32[tempDoublePtr+4>>2]|0;
    $369 = $368 & 2146435072;
    $370 = ($369>>>0)<(2146435072);
    $371 = (0)<(0);
    $372 = ($369|0)==(2146435072);
    $373 = $372 & $371;
    $374 = $370 | $373;
    do {
     if ($374) {
      $390 = (+_frexpl($$07$i,$e2$i));
      $391 = $390 * 2.0;
      $392 = $391 != 0.0;
      if ($392) {
       $393 = HEAP32[$e2$i>>2]|0;
       $394 = (($393) + -1)|0;
       HEAP32[$e2$i>>2] = $394;
      }
      $395 = $t$0 | 32;
      $396 = ($395|0)==(97);
      if ($396) {
       $397 = $t$0 & 32;
       $398 = ($397|0)==(0);
       $399 = ((($prefix$0$i)) + 9|0);
       $prefix$0$$i = $398 ? $prefix$0$i : $399;
       $400 = $pl$0$i | 2;
       $401 = ($p$0>>>0)>(11);
       $402 = (12 - ($p$0))|0;
       $403 = ($402|0)==(0);
       $404 = $401 | $403;
       do {
        if ($404) {
         $$1$i = $391;
        } else {
         $re$171$i = $402;$round$070$i = 8.0;
         while(1) {
          $405 = (($re$171$i) + -1)|0;
          $406 = $round$070$i * 16.0;
          $407 = ($405|0)==(0);
          if ($407) {
           $$lcssa319 = $406;
           break;
          } else {
           $re$171$i = $405;$round$070$i = $406;
          }
         }
         $408 = HEAP8[$prefix$0$$i>>0]|0;
         $409 = ($408<<24>>24)==(45);
         if ($409) {
          $410 = -$391;
          $411 = $410 - $$lcssa319;
          $412 = $$lcssa319 + $411;
          $413 = -$412;
          $$1$i = $413;
          break;
         } else {
          $414 = $391 + $$lcssa319;
          $415 = $414 - $$lcssa319;
          $$1$i = $415;
          break;
         }
        }
       } while(0);
       $416 = HEAP32[$e2$i>>2]|0;
       $417 = ($416|0)<(0);
       $418 = (0 - ($416))|0;
       $419 = $417 ? $418 : $416;
       $420 = ($419|0)<(0);
       $421 = $420 << 31 >> 31;
       $422 = (_fmt_u($419,$421,$7)|0);
       $423 = ($422|0)==($7|0);
       if ($423) {
        HEAP8[$8>>0] = 48;
        $estr$0$i = $8;
       } else {
        $estr$0$i = $422;
       }
       $424 = $416 >> 31;
       $425 = $424 & 2;
       $426 = (($425) + 43)|0;
       $427 = $426&255;
       $428 = ((($estr$0$i)) + -1|0);
       HEAP8[$428>>0] = $427;
       $429 = (($t$0) + 15)|0;
       $430 = $429&255;
       $431 = ((($estr$0$i)) + -2|0);
       HEAP8[$431>>0] = $430;
       $notrhs$i = ($p$0|0)<(1);
       $432 = $fl$1$ & 8;
       $433 = ($432|0)==(0);
       $$2$i = $$1$i;$s$0$i = $buf$i;
       while(1) {
        $434 = (~~(($$2$i)));
        $435 = (1326 + ($434)|0);
        $436 = HEAP8[$435>>0]|0;
        $437 = $436&255;
        $438 = $437 | $397;
        $439 = $438&255;
        $440 = ((($s$0$i)) + 1|0);
        HEAP8[$s$0$i>>0] = $439;
        $441 = (+($434|0));
        $442 = $$2$i - $441;
        $443 = $442 * 16.0;
        $444 = $440;
        $445 = (($444) - ($5))|0;
        $446 = ($445|0)==(1);
        do {
         if ($446) {
          $notlhs$i = $443 == 0.0;
          $or$cond3$not$i = $notrhs$i & $notlhs$i;
          $or$cond$i = $433 & $or$cond3$not$i;
          if ($or$cond$i) {
           $s$1$i = $440;
           break;
          }
          $447 = ((($s$0$i)) + 2|0);
          HEAP8[$440>>0] = 46;
          $s$1$i = $447;
         } else {
          $s$1$i = $440;
         }
        } while(0);
        $448 = $443 != 0.0;
        if ($448) {
         $$2$i = $443;$s$0$i = $s$1$i;
        } else {
         $s$1$i$lcssa = $s$1$i;
         break;
        }
       }
       $449 = ($p$0|0)!=(0);
       $$pre188$i = $s$1$i$lcssa;
       $450 = (($11) + ($$pre188$i))|0;
       $451 = ($450|0)<($p$0|0);
       $or$cond122 = $449 & $451;
       $452 = $431;
       $453 = (($12) + ($p$0))|0;
       $454 = (($453) - ($452))|0;
       $455 = (($10) - ($452))|0;
       $456 = (($455) + ($$pre188$i))|0;
       $l$0$i = $or$cond122 ? $454 : $456;
       $457 = (($l$0$i) + ($400))|0;
       _pad($f,32,$w$1,$457,$fl$1$);
       $458 = HEAP32[$f>>2]|0;
       $459 = $458 & 32;
       $460 = ($459|0)==(0);
       if ($460) {
        (___fwritex($prefix$0$$i,$400,$f)|0);
       }
       $461 = $fl$1$ ^ 65536;
       _pad($f,48,$w$1,$457,$461);
       $462 = (($$pre188$i) - ($5))|0;
       $463 = HEAP32[$f>>2]|0;
       $464 = $463 & 32;
       $465 = ($464|0)==(0);
       if ($465) {
        (___fwritex($buf$i,$462,$f)|0);
       }
       $466 = (($9) - ($452))|0;
       $sum = (($462) + ($466))|0;
       $467 = (($l$0$i) - ($sum))|0;
       _pad($f,48,$467,0,0);
       $468 = HEAP32[$f>>2]|0;
       $469 = $468 & 32;
       $470 = ($469|0)==(0);
       if ($470) {
        (___fwritex($431,$466,$f)|0);
       }
       $471 = $fl$1$ ^ 8192;
       _pad($f,32,$w$1,$457,$471);
       $472 = ($457|0)<($w$1|0);
       $w$$i = $472 ? $w$1 : $457;
       $$0$i = $w$$i;
       break;
      }
      $473 = ($p$0|0)<(0);
      $$p$i = $473 ? 6 : $p$0;
      if ($392) {
       $474 = $391 * 268435456.0;
       $475 = HEAP32[$e2$i>>2]|0;
       $476 = (($475) + -28)|0;
       HEAP32[$e2$i>>2] = $476;
       $$3$i = $474;$478 = $476;
      } else {
       $$pre185$i = HEAP32[$e2$i>>2]|0;
       $$3$i = $391;$478 = $$pre185$i;
      }
      $477 = ($478|0)<(0);
      $$33$i = $477 ? $big$i : $13;
      $479 = $$33$i;
      $$4$i = $$3$i;$z$0$i = $$33$i;
      while(1) {
       $480 = (~~(($$4$i))>>>0);
       HEAP32[$z$0$i>>2] = $480;
       $481 = ((($z$0$i)) + 4|0);
       $482 = (+($480>>>0));
       $483 = $$4$i - $482;
       $484 = $483 * 1.0E+9;
       $485 = $484 != 0.0;
       if ($485) {
        $$4$i = $484;$z$0$i = $481;
       } else {
        $$lcssa303 = $481;
        break;
       }
      }
      $$pr$i = HEAP32[$e2$i>>2]|0;
      $486 = ($$pr$i|0)>(0);
      if ($486) {
       $488 = $$pr$i;$a$1149$i = $$33$i;$z$1148$i = $$lcssa303;
       while(1) {
        $487 = ($488|0)>(29);
        $489 = $487 ? 29 : $488;
        $d$0141$i = ((($z$1148$i)) + -4|0);
        $490 = ($d$0141$i>>>0)<($a$1149$i>>>0);
        do {
         if ($490) {
          $a$2$ph$i = $a$1149$i;
         } else {
          $carry$0142$i = 0;$d$0143$i = $d$0141$i;
          while(1) {
           $491 = HEAP32[$d$0143$i>>2]|0;
           $492 = (_bitshift64Shl(($491|0),0,($489|0))|0);
           $493 = tempRet0;
           $494 = (_i64Add(($492|0),($493|0),($carry$0142$i|0),0)|0);
           $495 = tempRet0;
           $496 = (___uremdi3(($494|0),($495|0),1000000000,0)|0);
           $497 = tempRet0;
           HEAP32[$d$0143$i>>2] = $496;
           $498 = (___udivdi3(($494|0),($495|0),1000000000,0)|0);
           $499 = tempRet0;
           $d$0$i = ((($d$0143$i)) + -4|0);
           $500 = ($d$0$i>>>0)<($a$1149$i>>>0);
           if ($500) {
            $$lcssa304 = $498;
            break;
           } else {
            $carry$0142$i = $498;$d$0143$i = $d$0$i;
           }
          }
          $501 = ($$lcssa304|0)==(0);
          if ($501) {
           $a$2$ph$i = $a$1149$i;
           break;
          }
          $502 = ((($a$1149$i)) + -4|0);
          HEAP32[$502>>2] = $$lcssa304;
          $a$2$ph$i = $502;
         }
        } while(0);
        $z$2$i = $z$1148$i;
        while(1) {
         $503 = ($z$2$i>>>0)>($a$2$ph$i>>>0);
         if (!($503)) {
          $z$2$i$lcssa = $z$2$i;
          break;
         }
         $504 = ((($z$2$i)) + -4|0);
         $505 = HEAP32[$504>>2]|0;
         $506 = ($505|0)==(0);
         if ($506) {
          $z$2$i = $504;
         } else {
          $z$2$i$lcssa = $z$2$i;
          break;
         }
        }
        $507 = HEAP32[$e2$i>>2]|0;
        $508 = (($507) - ($489))|0;
        HEAP32[$e2$i>>2] = $508;
        $509 = ($508|0)>(0);
        if ($509) {
         $488 = $508;$a$1149$i = $a$2$ph$i;$z$1148$i = $z$2$i$lcssa;
        } else {
         $$pr50$i = $508;$a$1$lcssa$i = $a$2$ph$i;$z$1$lcssa$i = $z$2$i$lcssa;
         break;
        }
       }
      } else {
       $$pr50$i = $$pr$i;$a$1$lcssa$i = $$33$i;$z$1$lcssa$i = $$lcssa303;
      }
      $510 = ($$pr50$i|0)<(0);
      if ($510) {
       $511 = (($$p$i) + 25)|0;
       $512 = (($511|0) / 9)&-1;
       $513 = (($512) + 1)|0;
       $514 = ($395|0)==(102);
       $516 = $$pr50$i;$a$3136$i = $a$1$lcssa$i;$z$3135$i = $z$1$lcssa$i;
       while(1) {
        $515 = (0 - ($516))|0;
        $517 = ($515|0)>(9);
        $518 = $517 ? 9 : $515;
        $519 = ($a$3136$i>>>0)<($z$3135$i>>>0);
        do {
         if ($519) {
          $523 = 1 << $518;
          $524 = (($523) + -1)|0;
          $525 = 1000000000 >>> $518;
          $carry3$0130$i = 0;$d$1129$i = $a$3136$i;
          while(1) {
           $526 = HEAP32[$d$1129$i>>2]|0;
           $527 = $526 & $524;
           $528 = $526 >>> $518;
           $529 = (($528) + ($carry3$0130$i))|0;
           HEAP32[$d$1129$i>>2] = $529;
           $530 = Math_imul($527, $525)|0;
           $531 = ((($d$1129$i)) + 4|0);
           $532 = ($531>>>0)<($z$3135$i>>>0);
           if ($532) {
            $carry3$0130$i = $530;$d$1129$i = $531;
           } else {
            $$lcssa306 = $530;
            break;
           }
          }
          $533 = HEAP32[$a$3136$i>>2]|0;
          $534 = ($533|0)==(0);
          $535 = ((($a$3136$i)) + 4|0);
          $$a$3$i = $534 ? $535 : $a$3136$i;
          $536 = ($$lcssa306|0)==(0);
          if ($536) {
           $$a$3192$i = $$a$3$i;$z$4$i = $z$3135$i;
           break;
          }
          $537 = ((($z$3135$i)) + 4|0);
          HEAP32[$z$3135$i>>2] = $$lcssa306;
          $$a$3192$i = $$a$3$i;$z$4$i = $537;
         } else {
          $520 = HEAP32[$a$3136$i>>2]|0;
          $521 = ($520|0)==(0);
          $522 = ((($a$3136$i)) + 4|0);
          $$a$3191$i = $521 ? $522 : $a$3136$i;
          $$a$3192$i = $$a$3191$i;$z$4$i = $z$3135$i;
         }
        } while(0);
        $538 = $514 ? $$33$i : $$a$3192$i;
        $539 = $z$4$i;
        $540 = $538;
        $541 = (($539) - ($540))|0;
        $542 = $541 >> 2;
        $543 = ($542|0)>($513|0);
        $544 = (($538) + ($513<<2)|0);
        $$z$4$i = $543 ? $544 : $z$4$i;
        $545 = HEAP32[$e2$i>>2]|0;
        $546 = (($545) + ($518))|0;
        HEAP32[$e2$i>>2] = $546;
        $547 = ($546|0)<(0);
        if ($547) {
         $516 = $546;$a$3136$i = $$a$3192$i;$z$3135$i = $$z$4$i;
        } else {
         $a$3$lcssa$i = $$a$3192$i;$z$3$lcssa$i = $$z$4$i;
         break;
        }
       }
      } else {
       $a$3$lcssa$i = $a$1$lcssa$i;$z$3$lcssa$i = $z$1$lcssa$i;
      }
      $548 = ($a$3$lcssa$i>>>0)<($z$3$lcssa$i>>>0);
      do {
       if ($548) {
        $549 = $a$3$lcssa$i;
        $550 = (($479) - ($549))|0;
        $551 = $550 >> 2;
        $552 = ($551*9)|0;
        $553 = HEAP32[$a$3$lcssa$i>>2]|0;
        $554 = ($553>>>0)<(10);
        if ($554) {
         $e$1$i = $552;
         break;
        } else {
         $e$0125$i = $552;$i$0124$i = 10;
        }
        while(1) {
         $555 = ($i$0124$i*10)|0;
         $556 = (($e$0125$i) + 1)|0;
         $557 = ($553>>>0)<($555>>>0);
         if ($557) {
          $e$1$i = $556;
          break;
         } else {
          $e$0125$i = $556;$i$0124$i = $555;
         }
        }
       } else {
        $e$1$i = 0;
       }
      } while(0);
      $558 = ($395|0)!=(102);
      $559 = $558 ? $e$1$i : 0;
      $560 = (($$p$i) - ($559))|0;
      $561 = ($395|0)==(103);
      $562 = ($$p$i|0)!=(0);
      $563 = $562 & $561;
      $$neg55$i = $563 << 31 >> 31;
      $564 = (($560) + ($$neg55$i))|0;
      $565 = $z$3$lcssa$i;
      $566 = (($565) - ($479))|0;
      $567 = $566 >> 2;
      $568 = ($567*9)|0;
      $569 = (($568) + -9)|0;
      $570 = ($564|0)<($569|0);
      if ($570) {
       $571 = ((($$33$i)) + 4|0);
       $572 = (($564) + 9216)|0;
       $573 = (($572|0) / 9)&-1;
       $574 = (($573) + -1024)|0;
       $575 = (($571) + ($574<<2)|0);
       $576 = (($572|0) % 9)&-1;
       $j$0117$i = (($576) + 1)|0;
       $577 = ($j$0117$i|0)<(9);
       if ($577) {
        $i$1118$i = 10;$j$0119$i = $j$0117$i;
        while(1) {
         $578 = ($i$1118$i*10)|0;
         $j$0$i = (($j$0119$i) + 1)|0;
         $exitcond$i = ($j$0$i|0)==(9);
         if ($exitcond$i) {
          $i$1$lcssa$i = $578;
          break;
         } else {
          $i$1118$i = $578;$j$0119$i = $j$0$i;
         }
        }
       } else {
        $i$1$lcssa$i = 10;
       }
       $579 = HEAP32[$575>>2]|0;
       $580 = (($579>>>0) % ($i$1$lcssa$i>>>0))&-1;
       $581 = ($580|0)==(0);
       $582 = ((($575)) + 4|0);
       $583 = ($582|0)==($z$3$lcssa$i|0);
       $or$cond18$i = $583 & $581;
       do {
        if ($or$cond18$i) {
         $a$8$i = $a$3$lcssa$i;$d$4$i = $575;$e$4$i = $e$1$i;
        } else {
         $584 = (($579>>>0) / ($i$1$lcssa$i>>>0))&-1;
         $585 = $584 & 1;
         $586 = ($585|0)==(0);
         $$20$i = $586 ? 9007199254740992.0 : 9007199254740994.0;
         $587 = (($i$1$lcssa$i|0) / 2)&-1;
         $588 = ($580>>>0)<($587>>>0);
         if ($588) {
          $small$0$i = 0.5;
         } else {
          $589 = ($580|0)==($587|0);
          $or$cond22$i = $583 & $589;
          $$36$i = $or$cond22$i ? 1.0 : 1.5;
          $small$0$i = $$36$i;
         }
         $590 = ($pl$0$i|0)==(0);
         do {
          if ($590) {
           $round6$1$i = $$20$i;$small$1$i = $small$0$i;
          } else {
           $591 = HEAP8[$prefix$0$i>>0]|0;
           $592 = ($591<<24>>24)==(45);
           if (!($592)) {
            $round6$1$i = $$20$i;$small$1$i = $small$0$i;
            break;
           }
           $593 = -$$20$i;
           $594 = -$small$0$i;
           $round6$1$i = $593;$small$1$i = $594;
          }
         } while(0);
         $595 = (($579) - ($580))|0;
         HEAP32[$575>>2] = $595;
         $596 = $round6$1$i + $small$1$i;
         $597 = $596 != $round6$1$i;
         if (!($597)) {
          $a$8$i = $a$3$lcssa$i;$d$4$i = $575;$e$4$i = $e$1$i;
          break;
         }
         $598 = (($595) + ($i$1$lcssa$i))|0;
         HEAP32[$575>>2] = $598;
         $599 = ($598>>>0)>(999999999);
         if ($599) {
          $a$5111$i = $a$3$lcssa$i;$d$2110$i = $575;
          while(1) {
           $600 = ((($d$2110$i)) + -4|0);
           HEAP32[$d$2110$i>>2] = 0;
           $601 = ($600>>>0)<($a$5111$i>>>0);
           if ($601) {
            $602 = ((($a$5111$i)) + -4|0);
            HEAP32[$602>>2] = 0;
            $a$6$i = $602;
           } else {
            $a$6$i = $a$5111$i;
           }
           $603 = HEAP32[$600>>2]|0;
           $604 = (($603) + 1)|0;
           HEAP32[$600>>2] = $604;
           $605 = ($604>>>0)>(999999999);
           if ($605) {
            $a$5111$i = $a$6$i;$d$2110$i = $600;
           } else {
            $a$5$lcssa$i = $a$6$i;$d$2$lcssa$i = $600;
            break;
           }
          }
         } else {
          $a$5$lcssa$i = $a$3$lcssa$i;$d$2$lcssa$i = $575;
         }
         $606 = $a$5$lcssa$i;
         $607 = (($479) - ($606))|0;
         $608 = $607 >> 2;
         $609 = ($608*9)|0;
         $610 = HEAP32[$a$5$lcssa$i>>2]|0;
         $611 = ($610>>>0)<(10);
         if ($611) {
          $a$8$i = $a$5$lcssa$i;$d$4$i = $d$2$lcssa$i;$e$4$i = $609;
          break;
         } else {
          $e$2106$i = $609;$i$2105$i = 10;
         }
         while(1) {
          $612 = ($i$2105$i*10)|0;
          $613 = (($e$2106$i) + 1)|0;
          $614 = ($610>>>0)<($612>>>0);
          if ($614) {
           $a$8$i = $a$5$lcssa$i;$d$4$i = $d$2$lcssa$i;$e$4$i = $613;
           break;
          } else {
           $e$2106$i = $613;$i$2105$i = $612;
          }
         }
        }
       } while(0);
       $615 = ((($d$4$i)) + 4|0);
       $616 = ($z$3$lcssa$i>>>0)>($615>>>0);
       $$z$3$i = $616 ? $615 : $z$3$lcssa$i;
       $a$9$ph$i = $a$8$i;$e$5$ph$i = $e$4$i;$z$7$ph$i = $$z$3$i;
      } else {
       $a$9$ph$i = $a$3$lcssa$i;$e$5$ph$i = $e$1$i;$z$7$ph$i = $z$3$lcssa$i;
      }
      $617 = (0 - ($e$5$ph$i))|0;
      $z$7$i = $z$7$ph$i;
      while(1) {
       $618 = ($z$7$i>>>0)>($a$9$ph$i>>>0);
       if (!($618)) {
        $$lcssa162$i = 0;$z$7$i$lcssa = $z$7$i;
        break;
       }
       $619 = ((($z$7$i)) + -4|0);
       $620 = HEAP32[$619>>2]|0;
       $621 = ($620|0)==(0);
       if ($621) {
        $z$7$i = $619;
       } else {
        $$lcssa162$i = 1;$z$7$i$lcssa = $z$7$i;
        break;
       }
      }
      do {
       if ($561) {
        $622 = $562&1;
        $623 = $622 ^ 1;
        $$p$$i = (($623) + ($$p$i))|0;
        $624 = ($$p$$i|0)>($e$5$ph$i|0);
        $625 = ($e$5$ph$i|0)>(-5);
        $or$cond6$i = $624 & $625;
        if ($or$cond6$i) {
         $626 = (($t$0) + -1)|0;
         $$neg56$i = (($$p$$i) + -1)|0;
         $627 = (($$neg56$i) - ($e$5$ph$i))|0;
         $$013$i = $626;$$210$i = $627;
        } else {
         $628 = (($t$0) + -2)|0;
         $629 = (($$p$$i) + -1)|0;
         $$013$i = $628;$$210$i = $629;
        }
        $630 = $fl$1$ & 8;
        $631 = ($630|0)==(0);
        if (!($631)) {
         $$114$i = $$013$i;$$311$i = $$210$i;$$pre$phi190$iZ2D = $630;
         break;
        }
        do {
         if ($$lcssa162$i) {
          $632 = ((($z$7$i$lcssa)) + -4|0);
          $633 = HEAP32[$632>>2]|0;
          $634 = ($633|0)==(0);
          if ($634) {
           $j$2$i = 9;
           break;
          }
          $635 = (($633>>>0) % 10)&-1;
          $636 = ($635|0)==(0);
          if ($636) {
           $i$3101$i = 10;$j$1102$i = 0;
          } else {
           $j$2$i = 0;
           break;
          }
          while(1) {
           $637 = ($i$3101$i*10)|0;
           $638 = (($j$1102$i) + 1)|0;
           $639 = (($633>>>0) % ($637>>>0))&-1;
           $640 = ($639|0)==(0);
           if ($640) {
            $i$3101$i = $637;$j$1102$i = $638;
           } else {
            $j$2$i = $638;
            break;
           }
          }
         } else {
          $j$2$i = 9;
         }
        } while(0);
        $641 = $$013$i | 32;
        $642 = ($641|0)==(102);
        $643 = $z$7$i$lcssa;
        $644 = (($643) - ($479))|0;
        $645 = $644 >> 2;
        $646 = ($645*9)|0;
        $647 = (($646) + -9)|0;
        if ($642) {
         $648 = (($647) - ($j$2$i))|0;
         $649 = ($648|0)<(0);
         $$23$i = $649 ? 0 : $648;
         $650 = ($$210$i|0)<($$23$i|0);
         $$210$$24$i = $650 ? $$210$i : $$23$i;
         $$114$i = $$013$i;$$311$i = $$210$$24$i;$$pre$phi190$iZ2D = 0;
         break;
        } else {
         $651 = (($647) + ($e$5$ph$i))|0;
         $652 = (($651) - ($j$2$i))|0;
         $653 = ($652|0)<(0);
         $$25$i = $653 ? 0 : $652;
         $654 = ($$210$i|0)<($$25$i|0);
         $$210$$26$i = $654 ? $$210$i : $$25$i;
         $$114$i = $$013$i;$$311$i = $$210$$26$i;$$pre$phi190$iZ2D = 0;
         break;
        }
       } else {
        $$pre189$i = $fl$1$ & 8;
        $$114$i = $t$0;$$311$i = $$p$i;$$pre$phi190$iZ2D = $$pre189$i;
       }
      } while(0);
      $655 = $$311$i | $$pre$phi190$iZ2D;
      $656 = ($655|0)!=(0);
      $657 = $656&1;
      $658 = $$114$i | 32;
      $659 = ($658|0)==(102);
      if ($659) {
       $660 = ($e$5$ph$i|0)>(0);
       $661 = $660 ? $e$5$ph$i : 0;
       $$pn$i = $661;$estr$2$i = 0;
      } else {
       $662 = ($e$5$ph$i|0)<(0);
       $663 = $662 ? $617 : $e$5$ph$i;
       $664 = ($663|0)<(0);
       $665 = $664 << 31 >> 31;
       $666 = (_fmt_u($663,$665,$7)|0);
       $667 = $666;
       $668 = (($9) - ($667))|0;
       $669 = ($668|0)<(2);
       if ($669) {
        $estr$195$i = $666;
        while(1) {
         $670 = ((($estr$195$i)) + -1|0);
         HEAP8[$670>>0] = 48;
         $671 = $670;
         $672 = (($9) - ($671))|0;
         $673 = ($672|0)<(2);
         if ($673) {
          $estr$195$i = $670;
         } else {
          $estr$1$lcssa$i = $670;
          break;
         }
        }
       } else {
        $estr$1$lcssa$i = $666;
       }
       $674 = $e$5$ph$i >> 31;
       $675 = $674 & 2;
       $676 = (($675) + 43)|0;
       $677 = $676&255;
       $678 = ((($estr$1$lcssa$i)) + -1|0);
       HEAP8[$678>>0] = $677;
       $679 = $$114$i&255;
       $680 = ((($estr$1$lcssa$i)) + -2|0);
       HEAP8[$680>>0] = $679;
       $681 = $680;
       $682 = (($9) - ($681))|0;
       $$pn$i = $682;$estr$2$i = $680;
      }
      $683 = (($pl$0$i) + 1)|0;
      $684 = (($683) + ($$311$i))|0;
      $l$1$i = (($684) + ($657))|0;
      $685 = (($l$1$i) + ($$pn$i))|0;
      _pad($f,32,$w$1,$685,$fl$1$);
      $686 = HEAP32[$f>>2]|0;
      $687 = $686 & 32;
      $688 = ($687|0)==(0);
      if ($688) {
       (___fwritex($prefix$0$i,$pl$0$i,$f)|0);
      }
      $689 = $fl$1$ ^ 65536;
      _pad($f,48,$w$1,$685,$689);
      do {
       if ($659) {
        $690 = ($a$9$ph$i>>>0)>($$33$i>>>0);
        $r$0$a$9$i = $690 ? $$33$i : $a$9$ph$i;
        $d$584$i = $r$0$a$9$i;
        while(1) {
         $691 = HEAP32[$d$584$i>>2]|0;
         $692 = (_fmt_u($691,0,$14)|0);
         $693 = ($d$584$i|0)==($r$0$a$9$i|0);
         do {
          if ($693) {
           $699 = ($692|0)==($14|0);
           if (!($699)) {
            $s7$1$i = $692;
            break;
           }
           HEAP8[$16>>0] = 48;
           $s7$1$i = $16;
          } else {
           $694 = ($692>>>0)>($buf$i>>>0);
           if (!($694)) {
            $s7$1$i = $692;
            break;
           }
           $695 = $692;
           $696 = (($695) - ($5))|0;
           _memset(($buf$i|0),48,($696|0))|0;
           $s7$081$i = $692;
           while(1) {
            $697 = ((($s7$081$i)) + -1|0);
            $698 = ($697>>>0)>($buf$i>>>0);
            if ($698) {
             $s7$081$i = $697;
            } else {
             $s7$1$i = $697;
             break;
            }
           }
          }
         } while(0);
         $700 = HEAP32[$f>>2]|0;
         $701 = $700 & 32;
         $702 = ($701|0)==(0);
         if ($702) {
          $703 = $s7$1$i;
          $704 = (($15) - ($703))|0;
          (___fwritex($s7$1$i,$704,$f)|0);
         }
         $705 = ((($d$584$i)) + 4|0);
         $706 = ($705>>>0)>($$33$i>>>0);
         if ($706) {
          $$lcssa316 = $705;
          break;
         } else {
          $d$584$i = $705;
         }
        }
        $707 = ($655|0)==(0);
        do {
         if (!($707)) {
          $708 = HEAP32[$f>>2]|0;
          $709 = $708 & 32;
          $710 = ($709|0)==(0);
          if (!($710)) {
           break;
          }
          (___fwritex(3286,1,$f)|0);
         }
        } while(0);
        $711 = ($$lcssa316>>>0)<($z$7$i$lcssa>>>0);
        $712 = ($$311$i|0)>(0);
        $713 = $712 & $711;
        if ($713) {
         $$41278$i = $$311$i;$d$677$i = $$lcssa316;
         while(1) {
          $714 = HEAP32[$d$677$i>>2]|0;
          $715 = (_fmt_u($714,0,$14)|0);
          $716 = ($715>>>0)>($buf$i>>>0);
          if ($716) {
           $717 = $715;
           $718 = (($717) - ($5))|0;
           _memset(($buf$i|0),48,($718|0))|0;
           $s8$072$i = $715;
           while(1) {
            $719 = ((($s8$072$i)) + -1|0);
            $720 = ($719>>>0)>($buf$i>>>0);
            if ($720) {
             $s8$072$i = $719;
            } else {
             $s8$0$lcssa$i = $719;
             break;
            }
           }
          } else {
           $s8$0$lcssa$i = $715;
          }
          $721 = HEAP32[$f>>2]|0;
          $722 = $721 & 32;
          $723 = ($722|0)==(0);
          if ($723) {
           $724 = ($$41278$i|0)>(9);
           $725 = $724 ? 9 : $$41278$i;
           (___fwritex($s8$0$lcssa$i,$725,$f)|0);
          }
          $726 = ((($d$677$i)) + 4|0);
          $727 = (($$41278$i) + -9)|0;
          $728 = ($726>>>0)<($z$7$i$lcssa>>>0);
          $729 = ($$41278$i|0)>(9);
          $730 = $729 & $728;
          if ($730) {
           $$41278$i = $727;$d$677$i = $726;
          } else {
           $$412$lcssa$i = $727;
           break;
          }
         }
        } else {
         $$412$lcssa$i = $$311$i;
        }
        $731 = (($$412$lcssa$i) + 9)|0;
        _pad($f,48,$731,9,0);
       } else {
        $732 = ((($a$9$ph$i)) + 4|0);
        $z$7$$i = $$lcssa162$i ? $z$7$i$lcssa : $732;
        $733 = ($$311$i|0)>(-1);
        if ($733) {
         $734 = ($$pre$phi190$iZ2D|0)==(0);
         $$589$i = $$311$i;$d$788$i = $a$9$ph$i;
         while(1) {
          $735 = HEAP32[$d$788$i>>2]|0;
          $736 = (_fmt_u($735,0,$14)|0);
          $737 = ($736|0)==($14|0);
          if ($737) {
           HEAP8[$16>>0] = 48;
           $s9$0$i = $16;
          } else {
           $s9$0$i = $736;
          }
          $738 = ($d$788$i|0)==($a$9$ph$i|0);
          do {
           if ($738) {
            $742 = ((($s9$0$i)) + 1|0);
            $743 = HEAP32[$f>>2]|0;
            $744 = $743 & 32;
            $745 = ($744|0)==(0);
            if ($745) {
             (___fwritex($s9$0$i,1,$f)|0);
            }
            $746 = ($$589$i|0)<(1);
            $or$cond31$i = $734 & $746;
            if ($or$cond31$i) {
             $s9$2$i = $742;
             break;
            }
            $747 = HEAP32[$f>>2]|0;
            $748 = $747 & 32;
            $749 = ($748|0)==(0);
            if (!($749)) {
             $s9$2$i = $742;
             break;
            }
            (___fwritex(3286,1,$f)|0);
            $s9$2$i = $742;
           } else {
            $739 = ($s9$0$i>>>0)>($buf$i>>>0);
            if (!($739)) {
             $s9$2$i = $s9$0$i;
             break;
            }
            $scevgep182$i = (($s9$0$i) + ($6)|0);
            $scevgep182183$i = $scevgep182$i;
            _memset(($buf$i|0),48,($scevgep182183$i|0))|0;
            $s9$185$i = $s9$0$i;
            while(1) {
             $740 = ((($s9$185$i)) + -1|0);
             $741 = ($740>>>0)>($buf$i>>>0);
             if ($741) {
              $s9$185$i = $740;
             } else {
              $s9$2$i = $740;
              break;
             }
            }
           }
          } while(0);
          $750 = $s9$2$i;
          $751 = (($15) - ($750))|0;
          $752 = HEAP32[$f>>2]|0;
          $753 = $752 & 32;
          $754 = ($753|0)==(0);
          if ($754) {
           $755 = ($$589$i|0)>($751|0);
           $756 = $755 ? $751 : $$589$i;
           (___fwritex($s9$2$i,$756,$f)|0);
          }
          $757 = (($$589$i) - ($751))|0;
          $758 = ((($d$788$i)) + 4|0);
          $759 = ($758>>>0)<($z$7$$i>>>0);
          $760 = ($757|0)>(-1);
          $761 = $759 & $760;
          if ($761) {
           $$589$i = $757;$d$788$i = $758;
          } else {
           $$5$lcssa$i = $757;
           break;
          }
         }
        } else {
         $$5$lcssa$i = $$311$i;
        }
        $762 = (($$5$lcssa$i) + 18)|0;
        _pad($f,48,$762,18,0);
        $763 = HEAP32[$f>>2]|0;
        $764 = $763 & 32;
        $765 = ($764|0)==(0);
        if (!($765)) {
         break;
        }
        $766 = $estr$2$i;
        $767 = (($9) - ($766))|0;
        (___fwritex($estr$2$i,$767,$f)|0);
       }
      } while(0);
      $768 = $fl$1$ ^ 8192;
      _pad($f,32,$w$1,$685,$768);
      $769 = ($685|0)<($w$1|0);
      $w$32$i = $769 ? $w$1 : $685;
      $$0$i = $w$32$i;
     } else {
      $375 = $t$0 & 32;
      $376 = ($375|0)!=(0);
      $377 = $376 ? 3270 : 3274;
      $378 = ($$07$i != $$07$i) | (0.0 != 0.0);
      $379 = $376 ? 3278 : 3282;
      $pl$1$i = $378 ? 0 : $pl$0$i;
      $s1$0$i = $378 ? $379 : $377;
      $380 = (($pl$1$i) + 3)|0;
      _pad($f,32,$w$1,$380,$176);
      $381 = HEAP32[$f>>2]|0;
      $382 = $381 & 32;
      $383 = ($382|0)==(0);
      if ($383) {
       (___fwritex($prefix$0$i,$pl$1$i,$f)|0);
       $$pre$i = HEAP32[$f>>2]|0;
       $385 = $$pre$i;
      } else {
       $385 = $381;
      }
      $384 = $385 & 32;
      $386 = ($384|0)==(0);
      if ($386) {
       (___fwritex($s1$0$i,3,$f)|0);
      }
      $387 = $fl$1$ ^ 8192;
      _pad($f,32,$w$1,$380,$387);
      $388 = ($380|0)<($w$1|0);
      $389 = $388 ? $w$1 : $380;
      $$0$i = $389;
     }
    } while(0);
    $cnt$0 = $cnt$1;$l$0 = $$0$i;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
    continue L1;
    break;
   }
   default: {
    $a$2 = $s$0;$fl$6 = $fl$1$;$p$5 = $p$0;$pl$2 = 0;$prefix$2 = 1342;$z$2 = $1;
   }
   }
  } while(0);
  L311: do {
   if ((label|0) == 64) {
    label = 0;
    $207 = $arg;
    $208 = $207;
    $209 = HEAP32[$208>>2]|0;
    $210 = (($207) + 4)|0;
    $211 = $210;
    $212 = HEAP32[$211>>2]|0;
    $213 = $t$1 & 32;
    $214 = ($209|0)==(0);
    $215 = ($212|0)==(0);
    $216 = $214 & $215;
    if ($216) {
     $a$0 = $1;$fl$4 = $fl$3;$p$2 = $p$1;$pl$1 = 0;$prefix$1 = 1342;
     label = 77;
    } else {
     $$012$i = $1;$218 = $209;$225 = $212;
     while(1) {
      $217 = $218 & 15;
      $219 = (1326 + ($217)|0);
      $220 = HEAP8[$219>>0]|0;
      $221 = $220&255;
      $222 = $221 | $213;
      $223 = $222&255;
      $224 = ((($$012$i)) + -1|0);
      HEAP8[$224>>0] = $223;
      $226 = (_bitshift64Lshr(($218|0),($225|0),4)|0);
      $227 = tempRet0;
      $228 = ($226|0)==(0);
      $229 = ($227|0)==(0);
      $230 = $228 & $229;
      if ($230) {
       $$lcssa321 = $224;
       break;
      } else {
       $$012$i = $224;$218 = $226;$225 = $227;
      }
     }
     $231 = $arg;
     $232 = $231;
     $233 = HEAP32[$232>>2]|0;
     $234 = (($231) + 4)|0;
     $235 = $234;
     $236 = HEAP32[$235>>2]|0;
     $237 = ($233|0)==(0);
     $238 = ($236|0)==(0);
     $239 = $237 & $238;
     $240 = $fl$3 & 8;
     $241 = ($240|0)==(0);
     $or$cond17 = $241 | $239;
     if ($or$cond17) {
      $a$0 = $$lcssa321;$fl$4 = $fl$3;$p$2 = $p$1;$pl$1 = 0;$prefix$1 = 1342;
      label = 77;
     } else {
      $242 = $t$1 >> 4;
      $243 = (1342 + ($242)|0);
      $a$0 = $$lcssa321;$fl$4 = $fl$3;$p$2 = $p$1;$pl$1 = 2;$prefix$1 = $243;
      label = 77;
     }
    }
   }
   else if ((label|0) == 76) {
    label = 0;
    $289 = (_fmt_u($287,$288,$1)|0);
    $a$0 = $289;$fl$4 = $fl$1$;$p$2 = $p$0;$pl$1 = $pl$0;$prefix$1 = $prefix$0;
    label = 77;
   }
   else if ((label|0) == 82) {
    label = 0;
    $321 = (_memchr($a$1,0,$p$0)|0);
    $322 = ($321|0)==(0|0);
    $323 = $321;
    $324 = $a$1;
    $325 = (($323) - ($324))|0;
    $326 = (($a$1) + ($p$0)|0);
    $z$1 = $322 ? $326 : $321;
    $p$3 = $322 ? $p$0 : $325;
    $a$2 = $a$1;$fl$6 = $176;$p$5 = $p$3;$pl$2 = 0;$prefix$2 = 1342;$z$2 = $z$1;
   }
   else if ((label|0) == 86) {
    label = 0;
    $i$0105 = 0;$l$1104 = 0;$ws$0106 = $798;
    while(1) {
     $334 = HEAP32[$ws$0106>>2]|0;
     $335 = ($334|0)==(0);
     if ($335) {
      $i$0$lcssa = $i$0105;$l$2 = $l$1104;
      break;
     }
     $336 = (_wctomb($mb,$334)|0);
     $337 = ($336|0)<(0);
     $338 = (($p$4176) - ($i$0105))|0;
     $339 = ($336>>>0)>($338>>>0);
     $or$cond20 = $337 | $339;
     if ($or$cond20) {
      $i$0$lcssa = $i$0105;$l$2 = $336;
      break;
     }
     $340 = ((($ws$0106)) + 4|0);
     $341 = (($336) + ($i$0105))|0;
     $342 = ($p$4176>>>0)>($341>>>0);
     if ($342) {
      $i$0105 = $341;$l$1104 = $336;$ws$0106 = $340;
     } else {
      $i$0$lcssa = $341;$l$2 = $336;
      break;
     }
    }
    $343 = ($l$2|0)<(0);
    if ($343) {
     $$0 = -1;
     break L1;
    }
    _pad($f,32,$w$1,$i$0$lcssa,$fl$1$);
    $344 = ($i$0$lcssa|0)==(0);
    if ($344) {
     $i$0$lcssa178 = 0;
     label = 97;
    } else {
     $i$1116 = 0;$ws$1117 = $798;
     while(1) {
      $345 = HEAP32[$ws$1117>>2]|0;
      $346 = ($345|0)==(0);
      if ($346) {
       $i$0$lcssa178 = $i$0$lcssa;
       label = 97;
       break L311;
      }
      $347 = ((($ws$1117)) + 4|0);
      $348 = (_wctomb($mb,$345)|0);
      $349 = (($348) + ($i$1116))|0;
      $350 = ($349|0)>($i$0$lcssa|0);
      if ($350) {
       $i$0$lcssa178 = $i$0$lcssa;
       label = 97;
       break L311;
      }
      $351 = HEAP32[$f>>2]|0;
      $352 = $351 & 32;
      $353 = ($352|0)==(0);
      if ($353) {
       (___fwritex($mb,$348,$f)|0);
      }
      $354 = ($349>>>0)<($i$0$lcssa>>>0);
      if ($354) {
       $i$1116 = $349;$ws$1117 = $347;
      } else {
       $i$0$lcssa178 = $i$0$lcssa;
       label = 97;
       break;
      }
     }
    }
   }
  } while(0);
  if ((label|0) == 97) {
   label = 0;
   $355 = $fl$1$ ^ 8192;
   _pad($f,32,$w$1,$i$0$lcssa178,$355);
   $356 = ($w$1|0)>($i$0$lcssa178|0);
   $357 = $356 ? $w$1 : $i$0$lcssa178;
   $cnt$0 = $cnt$1;$l$0 = $357;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
   continue;
  }
  if ((label|0) == 77) {
   label = 0;
   $290 = ($p$2|0)>(-1);
   $291 = $fl$4 & -65537;
   $$fl$4 = $290 ? $291 : $fl$4;
   $292 = $arg;
   $293 = $292;
   $294 = HEAP32[$293>>2]|0;
   $295 = (($292) + 4)|0;
   $296 = $295;
   $297 = HEAP32[$296>>2]|0;
   $298 = ($294|0)!=(0);
   $299 = ($297|0)!=(0);
   $300 = $298 | $299;
   $301 = ($p$2|0)!=(0);
   $or$cond = $301 | $300;
   if ($or$cond) {
    $302 = $a$0;
    $303 = (($2) - ($302))|0;
    $304 = $300&1;
    $305 = $304 ^ 1;
    $306 = (($305) + ($303))|0;
    $307 = ($p$2|0)>($306|0);
    $p$2$ = $307 ? $p$2 : $306;
    $a$2 = $a$0;$fl$6 = $$fl$4;$p$5 = $p$2$;$pl$2 = $pl$1;$prefix$2 = $prefix$1;$z$2 = $1;
   } else {
    $a$2 = $1;$fl$6 = $$fl$4;$p$5 = 0;$pl$2 = $pl$1;$prefix$2 = $prefix$1;$z$2 = $1;
   }
  }
  $770 = $z$2;
  $771 = $a$2;
  $772 = (($770) - ($771))|0;
  $773 = ($p$5|0)<($772|0);
  $$p$5 = $773 ? $772 : $p$5;
  $774 = (($pl$2) + ($$p$5))|0;
  $775 = ($w$1|0)<($774|0);
  $w$2 = $775 ? $774 : $w$1;
  _pad($f,32,$w$2,$774,$fl$6);
  $776 = HEAP32[$f>>2]|0;
  $777 = $776 & 32;
  $778 = ($777|0)==(0);
  if ($778) {
   (___fwritex($prefix$2,$pl$2,$f)|0);
  }
  $779 = $fl$6 ^ 65536;
  _pad($f,48,$w$2,$774,$779);
  _pad($f,48,$$p$5,$772,0);
  $780 = HEAP32[$f>>2]|0;
  $781 = $780 & 32;
  $782 = ($781|0)==(0);
  if ($782) {
   (___fwritex($a$2,$772,$f)|0);
  }
  $783 = $fl$6 ^ 8192;
  _pad($f,32,$w$2,$774,$783);
  $cnt$0 = $cnt$1;$l$0 = $w$2;$l10n$0 = $l10n$3;$s$0 = $$lcssa300;
 }
 L345: do {
  if ((label|0) == 244) {
   $784 = ($f|0)==(0|0);
   if ($784) {
    $785 = ($l10n$0$lcssa|0)==(0);
    if ($785) {
     $$0 = 0;
    } else {
     $i$291 = 1;
     while(1) {
      $786 = (($nl_type) + ($i$291<<2)|0);
      $787 = HEAP32[$786>>2]|0;
      $788 = ($787|0)==(0);
      if ($788) {
       $i$291$lcssa = $i$291;
       break;
      }
      $790 = (($nl_arg) + ($i$291<<3)|0);
      _pop_arg($790,$787,$ap);
      $791 = (($i$291) + 1)|0;
      $792 = ($791|0)<(10);
      if ($792) {
       $i$291 = $791;
      } else {
       $$0 = 1;
       break L345;
      }
     }
     $789 = ($i$291$lcssa|0)<(10);
     if ($789) {
      $i$389 = $i$291$lcssa;
      while(1) {
       $795 = (($nl_type) + ($i$389<<2)|0);
       $796 = HEAP32[$795>>2]|0;
       $797 = ($796|0)==(0);
       $794 = (($i$389) + 1)|0;
       if (!($797)) {
        $$0 = -1;
        break L345;
       }
       $793 = ($794|0)<(10);
       if ($793) {
        $i$389 = $794;
       } else {
        $$0 = 1;
        break;
       }
      }
     } else {
      $$0 = 1;
     }
    }
   } else {
    $$0 = $cnt$1$lcssa;
   }
  }
 } while(0);
 STACKTOP = sp;return ($$0|0);
}
function ___fwritex($s,$l,$f) {
 $s = $s|0;
 $l = $l|0;
 $f = $f|0;
 var $$0 = 0, $$01 = 0, $$02 = 0, $$pre = 0, $$pre6 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0;
 var $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $i$0 = 0, $i$0$lcssa12 = 0;
 var $i$1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($f)) + 16|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)==(0|0);
 if ($2) {
  $4 = (___towrite($f)|0);
  $5 = ($4|0)==(0);
  if ($5) {
   $$pre = HEAP32[$0>>2]|0;
   $9 = $$pre;
   label = 5;
  } else {
   $$0 = 0;
  }
 } else {
  $3 = $1;
  $9 = $3;
  label = 5;
 }
 L5: do {
  if ((label|0) == 5) {
   $6 = ((($f)) + 20|0);
   $7 = HEAP32[$6>>2]|0;
   $8 = (($9) - ($7))|0;
   $10 = ($8>>>0)<($l>>>0);
   $11 = $7;
   if ($10) {
    $12 = ((($f)) + 36|0);
    $13 = HEAP32[$12>>2]|0;
    $14 = (FUNCTION_TABLE_iiii[$13 & 7]($f,$s,$l)|0);
    $$0 = $14;
    break;
   }
   $15 = ((($f)) + 75|0);
   $16 = HEAP8[$15>>0]|0;
   $17 = ($16<<24>>24)>(-1);
   L10: do {
    if ($17) {
     $i$0 = $l;
     while(1) {
      $18 = ($i$0|0)==(0);
      if ($18) {
       $$01 = $l;$$02 = $s;$29 = $11;$i$1 = 0;
       break L10;
      }
      $19 = (($i$0) + -1)|0;
      $20 = (($s) + ($19)|0);
      $21 = HEAP8[$20>>0]|0;
      $22 = ($21<<24>>24)==(10);
      if ($22) {
       $i$0$lcssa12 = $i$0;
       break;
      } else {
       $i$0 = $19;
      }
     }
     $23 = ((($f)) + 36|0);
     $24 = HEAP32[$23>>2]|0;
     $25 = (FUNCTION_TABLE_iiii[$24 & 7]($f,$s,$i$0$lcssa12)|0);
     $26 = ($25>>>0)<($i$0$lcssa12>>>0);
     if ($26) {
      $$0 = $i$0$lcssa12;
      break L5;
     }
     $27 = (($s) + ($i$0$lcssa12)|0);
     $28 = (($l) - ($i$0$lcssa12))|0;
     $$pre6 = HEAP32[$6>>2]|0;
     $$01 = $28;$$02 = $27;$29 = $$pre6;$i$1 = $i$0$lcssa12;
    } else {
     $$01 = $l;$$02 = $s;$29 = $11;$i$1 = 0;
    }
   } while(0);
   _memcpy(($29|0),($$02|0),($$01|0))|0;
   $30 = HEAP32[$6>>2]|0;
   $31 = (($30) + ($$01)|0);
   HEAP32[$6>>2] = $31;
   $32 = (($i$1) + ($$01))|0;
   $$0 = $32;
  }
 } while(0);
 return ($$0|0);
}
function ___towrite($f) {
 $f = $f|0;
 var $$0 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0;
 var $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($f)) + 74|0);
 $1 = HEAP8[$0>>0]|0;
 $2 = $1 << 24 >> 24;
 $3 = (($2) + 255)|0;
 $4 = $3 | $2;
 $5 = $4&255;
 HEAP8[$0>>0] = $5;
 $6 = HEAP32[$f>>2]|0;
 $7 = $6 & 8;
 $8 = ($7|0)==(0);
 if ($8) {
  $10 = ((($f)) + 8|0);
  HEAP32[$10>>2] = 0;
  $11 = ((($f)) + 4|0);
  HEAP32[$11>>2] = 0;
  $12 = ((($f)) + 44|0);
  $13 = HEAP32[$12>>2]|0;
  $14 = ((($f)) + 28|0);
  HEAP32[$14>>2] = $13;
  $15 = ((($f)) + 20|0);
  HEAP32[$15>>2] = $13;
  $16 = $13;
  $17 = ((($f)) + 48|0);
  $18 = HEAP32[$17>>2]|0;
  $19 = (($16) + ($18)|0);
  $20 = ((($f)) + 16|0);
  HEAP32[$20>>2] = $19;
  $$0 = 0;
 } else {
  $9 = $6 | 32;
  HEAP32[$f>>2] = $9;
  $$0 = -1;
 }
 return ($$0|0);
}
function _pop_arg($arg,$type,$ap) {
 $arg = $arg|0;
 $type = $type|0;
 $ap = $ap|0;
 var $$mask = 0, $$mask1 = 0, $0 = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0.0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0.0;
 var $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0;
 var $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0;
 var $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0;
 var $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0;
 var $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $arglist_current = 0, $arglist_current11 = 0, $arglist_current14 = 0, $arglist_current17 = 0;
 var $arglist_current2 = 0, $arglist_current20 = 0, $arglist_current23 = 0, $arglist_current26 = 0, $arglist_current5 = 0, $arglist_current8 = 0, $arglist_next = 0, $arglist_next12 = 0, $arglist_next15 = 0, $arglist_next18 = 0, $arglist_next21 = 0, $arglist_next24 = 0, $arglist_next27 = 0, $arglist_next3 = 0, $arglist_next6 = 0, $arglist_next9 = 0, $expanded = 0, $expanded28 = 0, $expanded30 = 0, $expanded31 = 0;
 var $expanded32 = 0, $expanded34 = 0, $expanded35 = 0, $expanded37 = 0, $expanded38 = 0, $expanded39 = 0, $expanded41 = 0, $expanded42 = 0, $expanded44 = 0, $expanded45 = 0, $expanded46 = 0, $expanded48 = 0, $expanded49 = 0, $expanded51 = 0, $expanded52 = 0, $expanded53 = 0, $expanded55 = 0, $expanded56 = 0, $expanded58 = 0, $expanded59 = 0;
 var $expanded60 = 0, $expanded62 = 0, $expanded63 = 0, $expanded65 = 0, $expanded66 = 0, $expanded67 = 0, $expanded69 = 0, $expanded70 = 0, $expanded72 = 0, $expanded73 = 0, $expanded74 = 0, $expanded76 = 0, $expanded77 = 0, $expanded79 = 0, $expanded80 = 0, $expanded81 = 0, $expanded83 = 0, $expanded84 = 0, $expanded86 = 0, $expanded87 = 0;
 var $expanded88 = 0, $expanded90 = 0, $expanded91 = 0, $expanded93 = 0, $expanded94 = 0, $expanded95 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ($type>>>0)>(20);
 L1: do {
  if (!($0)) {
   do {
    switch ($type|0) {
    case 9:  {
     $arglist_current = HEAP32[$ap>>2]|0;
     $1 = $arglist_current;
     $2 = ((0) + 4|0);
     $expanded28 = $2;
     $expanded = (($expanded28) - 1)|0;
     $3 = (($1) + ($expanded))|0;
     $4 = ((0) + 4|0);
     $expanded32 = $4;
     $expanded31 = (($expanded32) - 1)|0;
     $expanded30 = $expanded31 ^ -1;
     $5 = $3 & $expanded30;
     $6 = $5;
     $7 = HEAP32[$6>>2]|0;
     $arglist_next = ((($6)) + 4|0);
     HEAP32[$ap>>2] = $arglist_next;
     HEAP32[$arg>>2] = $7;
     break L1;
     break;
    }
    case 10:  {
     $arglist_current2 = HEAP32[$ap>>2]|0;
     $8 = $arglist_current2;
     $9 = ((0) + 4|0);
     $expanded35 = $9;
     $expanded34 = (($expanded35) - 1)|0;
     $10 = (($8) + ($expanded34))|0;
     $11 = ((0) + 4|0);
     $expanded39 = $11;
     $expanded38 = (($expanded39) - 1)|0;
     $expanded37 = $expanded38 ^ -1;
     $12 = $10 & $expanded37;
     $13 = $12;
     $14 = HEAP32[$13>>2]|0;
     $arglist_next3 = ((($13)) + 4|0);
     HEAP32[$ap>>2] = $arglist_next3;
     $15 = ($14|0)<(0);
     $16 = $15 << 31 >> 31;
     $17 = $arg;
     $18 = $17;
     HEAP32[$18>>2] = $14;
     $19 = (($17) + 4)|0;
     $20 = $19;
     HEAP32[$20>>2] = $16;
     break L1;
     break;
    }
    case 11:  {
     $arglist_current5 = HEAP32[$ap>>2]|0;
     $21 = $arglist_current5;
     $22 = ((0) + 4|0);
     $expanded42 = $22;
     $expanded41 = (($expanded42) - 1)|0;
     $23 = (($21) + ($expanded41))|0;
     $24 = ((0) + 4|0);
     $expanded46 = $24;
     $expanded45 = (($expanded46) - 1)|0;
     $expanded44 = $expanded45 ^ -1;
     $25 = $23 & $expanded44;
     $26 = $25;
     $27 = HEAP32[$26>>2]|0;
     $arglist_next6 = ((($26)) + 4|0);
     HEAP32[$ap>>2] = $arglist_next6;
     $28 = $arg;
     $29 = $28;
     HEAP32[$29>>2] = $27;
     $30 = (($28) + 4)|0;
     $31 = $30;
     HEAP32[$31>>2] = 0;
     break L1;
     break;
    }
    case 12:  {
     $arglist_current8 = HEAP32[$ap>>2]|0;
     $32 = $arglist_current8;
     $33 = ((0) + 8|0);
     $expanded49 = $33;
     $expanded48 = (($expanded49) - 1)|0;
     $34 = (($32) + ($expanded48))|0;
     $35 = ((0) + 8|0);
     $expanded53 = $35;
     $expanded52 = (($expanded53) - 1)|0;
     $expanded51 = $expanded52 ^ -1;
     $36 = $34 & $expanded51;
     $37 = $36;
     $38 = $37;
     $39 = $38;
     $40 = HEAP32[$39>>2]|0;
     $41 = (($38) + 4)|0;
     $42 = $41;
     $43 = HEAP32[$42>>2]|0;
     $arglist_next9 = ((($37)) + 8|0);
     HEAP32[$ap>>2] = $arglist_next9;
     $44 = $arg;
     $45 = $44;
     HEAP32[$45>>2] = $40;
     $46 = (($44) + 4)|0;
     $47 = $46;
     HEAP32[$47>>2] = $43;
     break L1;
     break;
    }
    case 13:  {
     $arglist_current11 = HEAP32[$ap>>2]|0;
     $48 = $arglist_current11;
     $49 = ((0) + 4|0);
     $expanded56 = $49;
     $expanded55 = (($expanded56) - 1)|0;
     $50 = (($48) + ($expanded55))|0;
     $51 = ((0) + 4|0);
     $expanded60 = $51;
     $expanded59 = (($expanded60) - 1)|0;
     $expanded58 = $expanded59 ^ -1;
     $52 = $50 & $expanded58;
     $53 = $52;
     $54 = HEAP32[$53>>2]|0;
     $arglist_next12 = ((($53)) + 4|0);
     HEAP32[$ap>>2] = $arglist_next12;
     $55 = $54&65535;
     $56 = $55 << 16 >> 16;
     $57 = ($56|0)<(0);
     $58 = $57 << 31 >> 31;
     $59 = $arg;
     $60 = $59;
     HEAP32[$60>>2] = $56;
     $61 = (($59) + 4)|0;
     $62 = $61;
     HEAP32[$62>>2] = $58;
     break L1;
     break;
    }
    case 14:  {
     $arglist_current14 = HEAP32[$ap>>2]|0;
     $63 = $arglist_current14;
     $64 = ((0) + 4|0);
     $expanded63 = $64;
     $expanded62 = (($expanded63) - 1)|0;
     $65 = (($63) + ($expanded62))|0;
     $66 = ((0) + 4|0);
     $expanded67 = $66;
     $expanded66 = (($expanded67) - 1)|0;
     $expanded65 = $expanded66 ^ -1;
     $67 = $65 & $expanded65;
     $68 = $67;
     $69 = HEAP32[$68>>2]|0;
     $arglist_next15 = ((($68)) + 4|0);
     HEAP32[$ap>>2] = $arglist_next15;
     $$mask1 = $69 & 65535;
     $70 = $arg;
     $71 = $70;
     HEAP32[$71>>2] = $$mask1;
     $72 = (($70) + 4)|0;
     $73 = $72;
     HEAP32[$73>>2] = 0;
     break L1;
     break;
    }
    case 15:  {
     $arglist_current17 = HEAP32[$ap>>2]|0;
     $74 = $arglist_current17;
     $75 = ((0) + 4|0);
     $expanded70 = $75;
     $expanded69 = (($expanded70) - 1)|0;
     $76 = (($74) + ($expanded69))|0;
     $77 = ((0) + 4|0);
     $expanded74 = $77;
     $expanded73 = (($expanded74) - 1)|0;
     $expanded72 = $expanded73 ^ -1;
     $78 = $76 & $expanded72;
     $79 = $78;
     $80 = HEAP32[$79>>2]|0;
     $arglist_next18 = ((($79)) + 4|0);
     HEAP32[$ap>>2] = $arglist_next18;
     $81 = $80&255;
     $82 = $81 << 24 >> 24;
     $83 = ($82|0)<(0);
     $84 = $83 << 31 >> 31;
     $85 = $arg;
     $86 = $85;
     HEAP32[$86>>2] = $82;
     $87 = (($85) + 4)|0;
     $88 = $87;
     HEAP32[$88>>2] = $84;
     break L1;
     break;
    }
    case 16:  {
     $arglist_current20 = HEAP32[$ap>>2]|0;
     $89 = $arglist_current20;
     $90 = ((0) + 4|0);
     $expanded77 = $90;
     $expanded76 = (($expanded77) - 1)|0;
     $91 = (($89) + ($expanded76))|0;
     $92 = ((0) + 4|0);
     $expanded81 = $92;
     $expanded80 = (($expanded81) - 1)|0;
     $expanded79 = $expanded80 ^ -1;
     $93 = $91 & $expanded79;
     $94 = $93;
     $95 = HEAP32[$94>>2]|0;
     $arglist_next21 = ((($94)) + 4|0);
     HEAP32[$ap>>2] = $arglist_next21;
     $$mask = $95 & 255;
     $96 = $arg;
     $97 = $96;
     HEAP32[$97>>2] = $$mask;
     $98 = (($96) + 4)|0;
     $99 = $98;
     HEAP32[$99>>2] = 0;
     break L1;
     break;
    }
    case 17:  {
     $arglist_current23 = HEAP32[$ap>>2]|0;
     $100 = $arglist_current23;
     $101 = ((0) + 8|0);
     $expanded84 = $101;
     $expanded83 = (($expanded84) - 1)|0;
     $102 = (($100) + ($expanded83))|0;
     $103 = ((0) + 8|0);
     $expanded88 = $103;
     $expanded87 = (($expanded88) - 1)|0;
     $expanded86 = $expanded87 ^ -1;
     $104 = $102 & $expanded86;
     $105 = $104;
     $106 = +HEAPF64[$105>>3];
     $arglist_next24 = ((($105)) + 8|0);
     HEAP32[$ap>>2] = $arglist_next24;
     HEAPF64[$arg>>3] = $106;
     break L1;
     break;
    }
    case 18:  {
     $arglist_current26 = HEAP32[$ap>>2]|0;
     $107 = $arglist_current26;
     $108 = ((0) + 8|0);
     $expanded91 = $108;
     $expanded90 = (($expanded91) - 1)|0;
     $109 = (($107) + ($expanded90))|0;
     $110 = ((0) + 8|0);
     $expanded95 = $110;
     $expanded94 = (($expanded95) - 1)|0;
     $expanded93 = $expanded94 ^ -1;
     $111 = $109 & $expanded93;
     $112 = $111;
     $113 = +HEAPF64[$112>>3];
     $arglist_next27 = ((($112)) + 8|0);
     HEAP32[$ap>>2] = $arglist_next27;
     HEAPF64[$arg>>3] = $113;
     break L1;
     break;
    }
    default: {
     break L1;
    }
    }
   } while(0);
  }
 } while(0);
 return;
}
function _fmt_u($0,$1,$s) {
 $0 = $0|0;
 $1 = $1|0;
 $s = $s|0;
 var $$0$lcssa = 0, $$01$lcssa$off0 = 0, $$05 = 0, $$1$lcssa = 0, $$12 = 0, $$lcssa19 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0;
 var $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $y$03 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $2 = ($1>>>0)>(0);
 $3 = ($0>>>0)>(4294967295);
 $4 = ($1|0)==(0);
 $5 = $4 & $3;
 $6 = $2 | $5;
 if ($6) {
  $$05 = $s;$7 = $0;$8 = $1;
  while(1) {
   $9 = (___uremdi3(($7|0),($8|0),10,0)|0);
   $10 = tempRet0;
   $11 = $9 | 48;
   $12 = $11&255;
   $13 = ((($$05)) + -1|0);
   HEAP8[$13>>0] = $12;
   $14 = (___udivdi3(($7|0),($8|0),10,0)|0);
   $15 = tempRet0;
   $16 = ($8>>>0)>(9);
   $17 = ($7>>>0)>(4294967295);
   $18 = ($8|0)==(9);
   $19 = $18 & $17;
   $20 = $16 | $19;
   if ($20) {
    $$05 = $13;$7 = $14;$8 = $15;
   } else {
    $$lcssa19 = $13;$28 = $14;$29 = $15;
    break;
   }
  }
  $$0$lcssa = $$lcssa19;$$01$lcssa$off0 = $28;
 } else {
  $$0$lcssa = $s;$$01$lcssa$off0 = $0;
 }
 $21 = ($$01$lcssa$off0|0)==(0);
 if ($21) {
  $$1$lcssa = $$0$lcssa;
 } else {
  $$12 = $$0$lcssa;$y$03 = $$01$lcssa$off0;
  while(1) {
   $22 = (($y$03>>>0) % 10)&-1;
   $23 = $22 | 48;
   $24 = $23&255;
   $25 = ((($$12)) + -1|0);
   HEAP8[$25>>0] = $24;
   $26 = (($y$03>>>0) / 10)&-1;
   $27 = ($y$03>>>0)<(10);
   if ($27) {
    $$1$lcssa = $25;
    break;
   } else {
    $$12 = $25;$y$03 = $26;
   }
  }
 }
 return ($$1$lcssa|0);
}
function _strerror($e) {
 $e = $e|0;
 var $$lcssa = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $i$03 = 0, $i$03$lcssa = 0, $i$12 = 0, $s$0$lcssa = 0, $s$01 = 0, $s$1 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $i$03 = 0;
 while(1) {
  $1 = (1352 + ($i$03)|0);
  $2 = HEAP8[$1>>0]|0;
  $3 = $2&255;
  $4 = ($3|0)==($e|0);
  if ($4) {
   $i$03$lcssa = $i$03;
   label = 2;
   break;
  }
  $5 = (($i$03) + 1)|0;
  $6 = ($5|0)==(87);
  if ($6) {
   $i$12 = 87;$s$01 = 1440;
   label = 5;
   break;
  } else {
   $i$03 = $5;
  }
 }
 if ((label|0) == 2) {
  $0 = ($i$03$lcssa|0)==(0);
  if ($0) {
   $s$0$lcssa = 1440;
  } else {
   $i$12 = $i$03$lcssa;$s$01 = 1440;
   label = 5;
  }
 }
 if ((label|0) == 5) {
  while(1) {
   label = 0;
   $s$1 = $s$01;
   while(1) {
    $7 = HEAP8[$s$1>>0]|0;
    $8 = ($7<<24>>24)==(0);
    $9 = ((($s$1)) + 1|0);
    if ($8) {
     $$lcssa = $9;
     break;
    } else {
     $s$1 = $9;
    }
   }
   $10 = (($i$12) + -1)|0;
   $11 = ($10|0)==(0);
   if ($11) {
    $s$0$lcssa = $$lcssa;
    break;
   } else {
    $i$12 = $10;$s$01 = $$lcssa;
    label = 5;
   }
  }
 }
 return ($s$0$lcssa|0);
}
function _pad($f,$c,$w,$l,$fl) {
 $f = $f|0;
 $c = $c|0;
 $w = $w|0;
 $l = $l|0;
 $fl = $fl|0;
 var $$0$lcssa6 = 0, $$02 = 0, $$pre = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0;
 var $8 = 0, $9 = 0, $or$cond = 0, $pad = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 256|0;
 $pad = sp;
 $0 = $fl & 73728;
 $1 = ($0|0)==(0);
 $2 = ($w|0)>($l|0);
 $or$cond = $2 & $1;
 do {
  if ($or$cond) {
   $3 = (($w) - ($l))|0;
   $4 = ($3>>>0)>(256);
   $5 = $4 ? 256 : $3;
   _memset(($pad|0),($c|0),($5|0))|0;
   $6 = ($3>>>0)>(255);
   $7 = HEAP32[$f>>2]|0;
   $8 = $7 & 32;
   $9 = ($8|0)==(0);
   if ($6) {
    $10 = (($w) - ($l))|0;
    $$02 = $3;$17 = $7;$18 = $9;
    while(1) {
     if ($18) {
      (___fwritex($pad,256,$f)|0);
      $$pre = HEAP32[$f>>2]|0;
      $14 = $$pre;
     } else {
      $14 = $17;
     }
     $11 = (($$02) + -256)|0;
     $12 = ($11>>>0)>(255);
     $13 = $14 & 32;
     $15 = ($13|0)==(0);
     if ($12) {
      $$02 = $11;$17 = $14;$18 = $15;
     } else {
      break;
     }
    }
    $16 = $10 & 255;
    if ($15) {
     $$0$lcssa6 = $16;
    } else {
     break;
    }
   } else {
    if ($9) {
     $$0$lcssa6 = $3;
    } else {
     break;
    }
   }
   (___fwritex($pad,$$0$lcssa6,$f)|0);
  }
 } while(0);
 STACKTOP = sp;return;
}
function _wctomb($s,$wc) {
 $s = $s|0;
 $wc = $wc|0;
 var $$0 = 0, $0 = 0, $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ($s|0)==(0|0);
 if ($0) {
  $$0 = 0;
 } else {
  $1 = (_wcrtomb($s,$wc,0)|0);
  $$0 = $1;
 }
 return ($$0|0);
}
function _wcrtomb($s,$wc,$st) {
 $s = $s|0;
 $wc = $wc|0;
 $st = $st|0;
 var $$0 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0;
 var $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0;
 var $44 = 0, $45 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ($s|0)==(0|0);
 do {
  if ($0) {
   $$0 = 1;
  } else {
   $1 = ($wc>>>0)<(128);
   if ($1) {
    $2 = $wc&255;
    HEAP8[$s>>0] = $2;
    $$0 = 1;
    break;
   }
   $3 = ($wc>>>0)<(2048);
   if ($3) {
    $4 = $wc >>> 6;
    $5 = $4 | 192;
    $6 = $5&255;
    $7 = ((($s)) + 1|0);
    HEAP8[$s>>0] = $6;
    $8 = $wc & 63;
    $9 = $8 | 128;
    $10 = $9&255;
    HEAP8[$7>>0] = $10;
    $$0 = 2;
    break;
   }
   $11 = ($wc>>>0)<(55296);
   $12 = $wc & -8192;
   $13 = ($12|0)==(57344);
   $or$cond = $11 | $13;
   if ($or$cond) {
    $14 = $wc >>> 12;
    $15 = $14 | 224;
    $16 = $15&255;
    $17 = ((($s)) + 1|0);
    HEAP8[$s>>0] = $16;
    $18 = $wc >>> 6;
    $19 = $18 & 63;
    $20 = $19 | 128;
    $21 = $20&255;
    $22 = ((($s)) + 2|0);
    HEAP8[$17>>0] = $21;
    $23 = $wc & 63;
    $24 = $23 | 128;
    $25 = $24&255;
    HEAP8[$22>>0] = $25;
    $$0 = 3;
    break;
   }
   $26 = (($wc) + -65536)|0;
   $27 = ($26>>>0)<(1048576);
   if ($27) {
    $28 = $wc >>> 18;
    $29 = $28 | 240;
    $30 = $29&255;
    $31 = ((($s)) + 1|0);
    HEAP8[$s>>0] = $30;
    $32 = $wc >>> 12;
    $33 = $32 & 63;
    $34 = $33 | 128;
    $35 = $34&255;
    $36 = ((($s)) + 2|0);
    HEAP8[$31>>0] = $35;
    $37 = $wc >>> 6;
    $38 = $37 & 63;
    $39 = $38 | 128;
    $40 = $39&255;
    $41 = ((($s)) + 3|0);
    HEAP8[$36>>0] = $40;
    $42 = $wc & 63;
    $43 = $42 | 128;
    $44 = $43&255;
    HEAP8[$41>>0] = $44;
    $$0 = 4;
    break;
   } else {
    $45 = (___errno_location()|0);
    HEAP32[$45>>2] = 84;
    $$0 = -1;
    break;
   }
  }
 } while(0);
 return ($$0|0);
}
function _frexpl($x,$e) {
 $x = +$x;
 $e = $e|0;
 var $0 = 0.0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (+_frexp($x,$e));
 return (+$0);
}
function _frexp($x,$e) {
 $x = +$x;
 $e = $e|0;
 var $$0 = 0.0, $$01 = 0.0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0.0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0.0, $7 = 0.0, $8 = 0, $9 = 0, $storemerge = 0, label = 0, sp = 0;
 sp = STACKTOP;
 HEAPF64[tempDoublePtr>>3] = $x;$0 = HEAP32[tempDoublePtr>>2]|0;
 $1 = HEAP32[tempDoublePtr+4>>2]|0;
 $2 = (_bitshift64Lshr(($0|0),($1|0),52)|0);
 $3 = tempRet0;
 $4 = $2 & 2047;
 switch ($4|0) {
 case 0:  {
  $5 = $x != 0.0;
  if ($5) {
   $6 = $x * 1.8446744073709552E+19;
   $7 = (+_frexp($6,$e));
   $8 = HEAP32[$e>>2]|0;
   $9 = (($8) + -64)|0;
   $$01 = $7;$storemerge = $9;
  } else {
   $$01 = $x;$storemerge = 0;
  }
  HEAP32[$e>>2] = $storemerge;
  $$0 = $$01;
  break;
 }
 case 2047:  {
  $$0 = $x;
  break;
 }
 default: {
  $10 = (($4) + -1022)|0;
  HEAP32[$e>>2] = $10;
  $11 = $1 & -2146435073;
  $12 = $11 | 1071644672;
  HEAP32[tempDoublePtr>>2] = $0;HEAP32[tempDoublePtr+4>>2] = $12;$13 = +HEAPF64[tempDoublePtr>>3];
  $$0 = $13;
 }
 }
 return (+$$0);
}
function ___lockfile($f) {
 $f = $f|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return 0;
}
function _strlen($s) {
 $s = $s|0;
 var $$0 = 0, $$01$lcssa = 0, $$014 = 0, $$1$lcssa = 0, $$lcssa20 = 0, $$pn = 0, $$pn15 = 0, $$pre = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0;
 var $2 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $w$0 = 0, $w$0$lcssa = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = $s;
 $1 = $0 & 3;
 $2 = ($1|0)==(0);
 L1: do {
  if ($2) {
   $$01$lcssa = $s;
   label = 4;
  } else {
   $$014 = $s;$21 = $0;
   while(1) {
    $3 = HEAP8[$$014>>0]|0;
    $4 = ($3<<24>>24)==(0);
    if ($4) {
     $$pn = $21;
     break L1;
    }
    $5 = ((($$014)) + 1|0);
    $6 = $5;
    $7 = $6 & 3;
    $8 = ($7|0)==(0);
    if ($8) {
     $$01$lcssa = $5;
     label = 4;
     break;
    } else {
     $$014 = $5;$21 = $6;
    }
   }
  }
 } while(0);
 if ((label|0) == 4) {
  $w$0 = $$01$lcssa;
  while(1) {
   $9 = HEAP32[$w$0>>2]|0;
   $10 = (($9) + -16843009)|0;
   $11 = $9 & -2139062144;
   $12 = $11 ^ -2139062144;
   $13 = $12 & $10;
   $14 = ($13|0)==(0);
   $15 = ((($w$0)) + 4|0);
   if ($14) {
    $w$0 = $15;
   } else {
    $$lcssa20 = $9;$w$0$lcssa = $w$0;
    break;
   }
  }
  $16 = $$lcssa20&255;
  $17 = ($16<<24>>24)==(0);
  if ($17) {
   $$1$lcssa = $w$0$lcssa;
  } else {
   $$pn15 = $w$0$lcssa;
   while(1) {
    $18 = ((($$pn15)) + 1|0);
    $$pre = HEAP8[$18>>0]|0;
    $19 = ($$pre<<24>>24)==(0);
    if ($19) {
     $$1$lcssa = $18;
     break;
    } else {
     $$pn15 = $18;
    }
   }
  }
  $20 = $$1$lcssa;
  $$pn = $20;
 }
 $$0 = (($$pn) - ($0))|0;
 return ($$0|0);
}
function _fflush($f) {
 $f = $f|0;
 var $$0 = 0, $$01 = 0, $$012 = 0, $$014 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0;
 var $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $phitmp = 0, $r$0$lcssa = 0, $r$03 = 0, $r$1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ($f|0)==(0|0);
 do {
  if ($0) {
   $7 = HEAP32[88]|0;
   $8 = ($7|0)==(0|0);
   if ($8) {
    $27 = 0;
   } else {
    $9 = HEAP32[88]|0;
    $10 = (_fflush($9)|0);
    $27 = $10;
   }
   ___lock(((44196)|0));
   $$012 = HEAP32[(44192)>>2]|0;
   $11 = ($$012|0)==(0|0);
   if ($11) {
    $r$0$lcssa = $27;
   } else {
    $$014 = $$012;$r$03 = $27;
    while(1) {
     $12 = ((($$014)) + 76|0);
     $13 = HEAP32[$12>>2]|0;
     $14 = ($13|0)>(-1);
     if ($14) {
      $15 = (___lockfile($$014)|0);
      $24 = $15;
     } else {
      $24 = 0;
     }
     $16 = ((($$014)) + 20|0);
     $17 = HEAP32[$16>>2]|0;
     $18 = ((($$014)) + 28|0);
     $19 = HEAP32[$18>>2]|0;
     $20 = ($17>>>0)>($19>>>0);
     if ($20) {
      $21 = (___fflush_unlocked($$014)|0);
      $22 = $21 | $r$03;
      $r$1 = $22;
     } else {
      $r$1 = $r$03;
     }
     $23 = ($24|0)==(0);
     if (!($23)) {
      ___unlockfile($$014);
     }
     $25 = ((($$014)) + 56|0);
     $$01 = HEAP32[$25>>2]|0;
     $26 = ($$01|0)==(0|0);
     if ($26) {
      $r$0$lcssa = $r$1;
      break;
     } else {
      $$014 = $$01;$r$03 = $r$1;
     }
    }
   }
   ___unlock(((44196)|0));
   $$0 = $r$0$lcssa;
  } else {
   $1 = ((($f)) + 76|0);
   $2 = HEAP32[$1>>2]|0;
   $3 = ($2|0)>(-1);
   if (!($3)) {
    $4 = (___fflush_unlocked($f)|0);
    $$0 = $4;
    break;
   }
   $5 = (___lockfile($f)|0);
   $phitmp = ($5|0)==(0);
   $6 = (___fflush_unlocked($f)|0);
   if ($phitmp) {
    $$0 = $6;
   } else {
    ___unlockfile($f);
    $$0 = $6;
   }
  }
 } while(0);
 return ($$0|0);
}
function ___fflush_unlocked($f) {
 $f = $f|0;
 var $$0 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0;
 var $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($f)) + 20|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ((($f)) + 28|0);
 $3 = HEAP32[$2>>2]|0;
 $4 = ($1>>>0)>($3>>>0);
 if ($4) {
  $5 = ((($f)) + 36|0);
  $6 = HEAP32[$5>>2]|0;
  (FUNCTION_TABLE_iiii[$6 & 7]($f,0,0)|0);
  $7 = HEAP32[$0>>2]|0;
  $8 = ($7|0)==(0|0);
  if ($8) {
   $$0 = -1;
  } else {
   label = 3;
  }
 } else {
  label = 3;
 }
 if ((label|0) == 3) {
  $9 = ((($f)) + 4|0);
  $10 = HEAP32[$9>>2]|0;
  $11 = ((($f)) + 8|0);
  $12 = HEAP32[$11>>2]|0;
  $13 = ($10>>>0)<($12>>>0);
  if ($13) {
   $14 = ((($f)) + 40|0);
   $15 = HEAP32[$14>>2]|0;
   $16 = $10;
   $17 = $12;
   $18 = (($16) - ($17))|0;
   (FUNCTION_TABLE_iiii[$15 & 7]($f,$18,1)|0);
  }
  $19 = ((($f)) + 16|0);
  HEAP32[$19>>2] = 0;
  HEAP32[$2>>2] = 0;
  HEAP32[$0>>2] = 0;
  HEAP32[$11>>2] = 0;
  HEAP32[$9>>2] = 0;
  $$0 = 0;
 }
 return ($$0|0);
}
function _fputc($c,$f) {
 $c = $c|0;
 $f = $f|0;
 var $$0 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0;
 var $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($f)) + 76|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)<(0);
 if ($2) {
  label = 3;
 } else {
  $3 = (___lockfile($f)|0);
  $4 = ($3|0)==(0);
  if ($4) {
   label = 3;
  } else {
   $18 = ((($f)) + 75|0);
   $19 = HEAP8[$18>>0]|0;
   $20 = $19 << 24 >> 24;
   $21 = ($20|0)==($c|0);
   if ($21) {
    label = 10;
   } else {
    $22 = ((($f)) + 20|0);
    $23 = HEAP32[$22>>2]|0;
    $24 = ((($f)) + 16|0);
    $25 = HEAP32[$24>>2]|0;
    $26 = ($23>>>0)<($25>>>0);
    if ($26) {
     $27 = $c&255;
     $28 = ((($23)) + 1|0);
     HEAP32[$22>>2] = $28;
     HEAP8[$23>>0] = $27;
     $29 = $c & 255;
     $31 = $29;
    } else {
     label = 10;
    }
   }
   if ((label|0) == 10) {
    $30 = (___overflow($f,$c)|0);
    $31 = $30;
   }
   ___unlockfile($f);
   $$0 = $31;
  }
 }
 do {
  if ((label|0) == 3) {
   $5 = ((($f)) + 75|0);
   $6 = HEAP8[$5>>0]|0;
   $7 = $6 << 24 >> 24;
   $8 = ($7|0)==($c|0);
   if (!($8)) {
    $9 = ((($f)) + 20|0);
    $10 = HEAP32[$9>>2]|0;
    $11 = ((($f)) + 16|0);
    $12 = HEAP32[$11>>2]|0;
    $13 = ($10>>>0)<($12>>>0);
    if ($13) {
     $14 = $c&255;
     $15 = ((($10)) + 1|0);
     HEAP32[$9>>2] = $15;
     HEAP8[$10>>0] = $14;
     $16 = $c & 255;
     $$0 = $16;
     break;
    }
   }
   $17 = (___overflow($f,$c)|0);
   $$0 = $17;
  }
 } while(0);
 return ($$0|0);
}
function ___overflow($f,$_c) {
 $f = $f|0;
 $_c = $_c|0;
 var $$0 = 0, $$pre = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $3 = 0, $4 = 0, $5 = 0;
 var $6 = 0, $7 = 0, $8 = 0, $9 = 0, $c = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $c = sp;
 $0 = $_c&255;
 HEAP8[$c>>0] = $0;
 $1 = ((($f)) + 16|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = ($2|0)==(0|0);
 if ($3) {
  $4 = (___towrite($f)|0);
  $5 = ($4|0)==(0);
  if ($5) {
   $$pre = HEAP32[$1>>2]|0;
   $9 = $$pre;
   label = 4;
  } else {
   $$0 = -1;
  }
 } else {
  $9 = $2;
  label = 4;
 }
 do {
  if ((label|0) == 4) {
   $6 = ((($f)) + 20|0);
   $7 = HEAP32[$6>>2]|0;
   $8 = ($7>>>0)<($9>>>0);
   if ($8) {
    $10 = $_c & 255;
    $11 = ((($f)) + 75|0);
    $12 = HEAP8[$11>>0]|0;
    $13 = $12 << 24 >> 24;
    $14 = ($10|0)==($13|0);
    if (!($14)) {
     $15 = ((($7)) + 1|0);
     HEAP32[$6>>2] = $15;
     HEAP8[$7>>0] = $0;
     $$0 = $10;
     break;
    }
   }
   $16 = ((($f)) + 36|0);
   $17 = HEAP32[$16>>2]|0;
   $18 = (FUNCTION_TABLE_iiii[$17 & 7]($f,$c,1)|0);
   $19 = ($18|0)==(1);
   if ($19) {
    $20 = HEAP8[$c>>0]|0;
    $21 = $20&255;
    $$0 = $21;
   } else {
    $$0 = -1;
   }
  }
 } while(0);
 STACKTOP = sp;return ($$0|0);
}
function _fputs($s,$f) {
 $s = $s|0;
 $f = $f|0;
 var $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_strlen($s)|0);
 $1 = (_fwrite($s,$0,1,$f)|0);
 $2 = (($1) + -1)|0;
 return ($2|0);
}
function _fwrite($src,$size,$nmemb,$f) {
 $src = $src|0;
 $size = $size|0;
 $nmemb = $nmemb|0;
 $f = $f|0;
 var $0 = 0, $1 = 0, $10 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $phitmp = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = Math_imul($nmemb, $size)|0;
 $1 = ((($f)) + 76|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = ($2|0)>(-1);
 if ($3) {
  $5 = (___lockfile($f)|0);
  $phitmp = ($5|0)==(0);
  $6 = (___fwritex($src,$0,$f)|0);
  if ($phitmp) {
   $8 = $6;
  } else {
   ___unlockfile($f);
   $8 = $6;
  }
 } else {
  $4 = (___fwritex($src,$0,$f)|0);
  $8 = $4;
 }
 $7 = ($8|0)==($0|0);
 if ($7) {
  $10 = $nmemb;
 } else {
  $9 = (($8>>>0) / ($size>>>0))&-1;
  $10 = $9;
 }
 return ($10|0);
}
function _puts($s) {
 $s = $s|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0;
 var $9 = 0, $phitmp = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[59]|0;
 $1 = ((($0)) + 76|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = ($2|0)>(-1);
 if ($3) {
  $4 = (___lockfile($0)|0);
  $20 = $4;
 } else {
  $20 = 0;
 }
 $5 = (_fputs($s,$0)|0);
 $6 = ($5|0)<(0);
 do {
  if ($6) {
   $18 = 1;
  } else {
   $7 = ((($0)) + 75|0);
   $8 = HEAP8[$7>>0]|0;
   $9 = ($8<<24>>24)==(10);
   if (!($9)) {
    $10 = ((($0)) + 20|0);
    $11 = HEAP32[$10>>2]|0;
    $12 = ((($0)) + 16|0);
    $13 = HEAP32[$12>>2]|0;
    $14 = ($11>>>0)<($13>>>0);
    if ($14) {
     $15 = ((($11)) + 1|0);
     HEAP32[$10>>2] = $15;
     HEAP8[$11>>0] = 10;
     $18 = 0;
     break;
    }
   }
   $16 = (___overflow($0,10)|0);
   $phitmp = ($16|0)<(0);
   $18 = $phitmp;
  }
 } while(0);
 $17 = $18 << 31 >> 31;
 $19 = ($20|0)==(0);
 if (!($19)) {
  ___unlockfile($0);
 }
 return ($17|0);
}
function _malloc($bytes) {
 $bytes = $bytes|0;
 var $$0 = 0, $$lcssa = 0, $$lcssa141 = 0, $$lcssa142 = 0, $$lcssa144 = 0, $$lcssa147 = 0, $$lcssa149 = 0, $$lcssa151 = 0, $$lcssa153 = 0, $$lcssa155 = 0, $$lcssa157 = 0, $$not$i = 0, $$pre = 0, $$pre$i = 0, $$pre$i$i = 0, $$pre$i13 = 0, $$pre$i16$i = 0, $$pre$phi$i$iZ2D = 0, $$pre$phi$i14Z2D = 0, $$pre$phi$i17$iZ2D = 0;
 var $$pre$phi$iZ2D = 0, $$pre$phi10$i$iZ2D = 0, $$pre$phiZ2D = 0, $$pre71 = 0, $$pre9$i$i = 0, $$rsize$0$i = 0, $$rsize$4$i = 0, $$v$0$i = 0, $0 = 0, $1 = 0, $10 = 0, $100 = 0, $1000 = 0, $1001 = 0, $1002 = 0, $1003 = 0, $1004 = 0, $1005 = 0, $1006 = 0, $1007 = 0;
 var $1008 = 0, $1009 = 0, $101 = 0, $1010 = 0, $1011 = 0, $1012 = 0, $1013 = 0, $1014 = 0, $1015 = 0, $1016 = 0, $1017 = 0, $1018 = 0, $1019 = 0, $102 = 0, $1020 = 0, $1021 = 0, $1022 = 0, $1023 = 0, $1024 = 0, $1025 = 0;
 var $1026 = 0, $1027 = 0, $1028 = 0, $1029 = 0, $103 = 0, $1030 = 0, $1031 = 0, $1032 = 0, $1033 = 0, $1034 = 0, $1035 = 0, $1036 = 0, $1037 = 0, $1038 = 0, $1039 = 0, $104 = 0, $1040 = 0, $1041 = 0, $1042 = 0, $1043 = 0;
 var $1044 = 0, $1045 = 0, $1046 = 0, $1047 = 0, $1048 = 0, $1049 = 0, $105 = 0, $1050 = 0, $1051 = 0, $1052 = 0, $1053 = 0, $1054 = 0, $1055 = 0, $1056 = 0, $1057 = 0, $1058 = 0, $1059 = 0, $106 = 0, $1060 = 0, $1061 = 0;
 var $1062 = 0, $1063 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0;
 var $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0;
 var $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0;
 var $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0, $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0;
 var $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0;
 var $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0;
 var $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0;
 var $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0;
 var $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0;
 var $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0, $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0;
 var $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0, $297 = 0, $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0;
 var $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0, $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0;
 var $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0, $331 = 0, $332 = 0, $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0;
 var $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0, $348 = 0, $349 = 0, $35 = 0, $350 = 0, $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0;
 var $358 = 0, $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0, $363 = 0, $364 = 0, $365 = 0, $366 = 0, $367 = 0, $368 = 0, $369 = 0, $37 = 0, $370 = 0, $371 = 0, $372 = 0, $373 = 0, $374 = 0, $375 = 0;
 var $376 = 0, $377 = 0, $378 = 0, $379 = 0, $38 = 0, $380 = 0, $381 = 0, $382 = 0, $383 = 0, $384 = 0, $385 = 0, $386 = 0, $387 = 0, $388 = 0, $389 = 0, $39 = 0, $390 = 0, $391 = 0, $392 = 0, $393 = 0;
 var $394 = 0, $395 = 0, $396 = 0, $397 = 0, $398 = 0, $399 = 0, $4 = 0, $40 = 0, $400 = 0, $401 = 0, $402 = 0, $403 = 0, $404 = 0, $405 = 0, $406 = 0, $407 = 0, $408 = 0, $409 = 0, $41 = 0, $410 = 0;
 var $411 = 0, $412 = 0, $413 = 0, $414 = 0, $415 = 0, $416 = 0, $417 = 0, $418 = 0, $419 = 0, $42 = 0, $420 = 0, $421 = 0, $422 = 0, $423 = 0, $424 = 0, $425 = 0, $426 = 0, $427 = 0, $428 = 0, $429 = 0;
 var $43 = 0, $430 = 0, $431 = 0, $432 = 0, $433 = 0, $434 = 0, $435 = 0, $436 = 0, $437 = 0, $438 = 0, $439 = 0, $44 = 0, $440 = 0, $441 = 0, $442 = 0, $443 = 0, $444 = 0, $445 = 0, $446 = 0, $447 = 0;
 var $448 = 0, $449 = 0, $45 = 0, $450 = 0, $451 = 0, $452 = 0, $453 = 0, $454 = 0, $455 = 0, $456 = 0, $457 = 0, $458 = 0, $459 = 0, $46 = 0, $460 = 0, $461 = 0, $462 = 0, $463 = 0, $464 = 0, $465 = 0;
 var $466 = 0, $467 = 0, $468 = 0, $469 = 0, $47 = 0, $470 = 0, $471 = 0, $472 = 0, $473 = 0, $474 = 0, $475 = 0, $476 = 0, $477 = 0, $478 = 0, $479 = 0, $48 = 0, $480 = 0, $481 = 0, $482 = 0, $483 = 0;
 var $484 = 0, $485 = 0, $486 = 0, $487 = 0, $488 = 0, $489 = 0, $49 = 0, $490 = 0, $491 = 0, $492 = 0, $493 = 0, $494 = 0, $495 = 0, $496 = 0, $497 = 0, $498 = 0, $499 = 0, $5 = 0, $50 = 0, $500 = 0;
 var $501 = 0, $502 = 0, $503 = 0, $504 = 0, $505 = 0, $506 = 0, $507 = 0, $508 = 0, $509 = 0, $51 = 0, $510 = 0, $511 = 0, $512 = 0, $513 = 0, $514 = 0, $515 = 0, $516 = 0, $517 = 0, $518 = 0, $519 = 0;
 var $52 = 0, $520 = 0, $521 = 0, $522 = 0, $523 = 0, $524 = 0, $525 = 0, $526 = 0, $527 = 0, $528 = 0, $529 = 0, $53 = 0, $530 = 0, $531 = 0, $532 = 0, $533 = 0, $534 = 0, $535 = 0, $536 = 0, $537 = 0;
 var $538 = 0, $539 = 0, $54 = 0, $540 = 0, $541 = 0, $542 = 0, $543 = 0, $544 = 0, $545 = 0, $546 = 0, $547 = 0, $548 = 0, $549 = 0, $55 = 0, $550 = 0, $551 = 0, $552 = 0, $553 = 0, $554 = 0, $555 = 0;
 var $556 = 0, $557 = 0, $558 = 0, $559 = 0, $56 = 0, $560 = 0, $561 = 0, $562 = 0, $563 = 0, $564 = 0, $565 = 0, $566 = 0, $567 = 0, $568 = 0, $569 = 0, $57 = 0, $570 = 0, $571 = 0, $572 = 0, $573 = 0;
 var $574 = 0, $575 = 0, $576 = 0, $577 = 0, $578 = 0, $579 = 0, $58 = 0, $580 = 0, $581 = 0, $582 = 0, $583 = 0, $584 = 0, $585 = 0, $586 = 0, $587 = 0, $588 = 0, $589 = 0, $59 = 0, $590 = 0, $591 = 0;
 var $592 = 0, $593 = 0, $594 = 0, $595 = 0, $596 = 0, $597 = 0, $598 = 0, $599 = 0, $6 = 0, $60 = 0, $600 = 0, $601 = 0, $602 = 0, $603 = 0, $604 = 0, $605 = 0, $606 = 0, $607 = 0, $608 = 0, $609 = 0;
 var $61 = 0, $610 = 0, $611 = 0, $612 = 0, $613 = 0, $614 = 0, $615 = 0, $616 = 0, $617 = 0, $618 = 0, $619 = 0, $62 = 0, $620 = 0, $621 = 0, $622 = 0, $623 = 0, $624 = 0, $625 = 0, $626 = 0, $627 = 0;
 var $628 = 0, $629 = 0, $63 = 0, $630 = 0, $631 = 0, $632 = 0, $633 = 0, $634 = 0, $635 = 0, $636 = 0, $637 = 0, $638 = 0, $639 = 0, $64 = 0, $640 = 0, $641 = 0, $642 = 0, $643 = 0, $644 = 0, $645 = 0;
 var $646 = 0, $647 = 0, $648 = 0, $649 = 0, $65 = 0, $650 = 0, $651 = 0, $652 = 0, $653 = 0, $654 = 0, $655 = 0, $656 = 0, $657 = 0, $658 = 0, $659 = 0, $66 = 0, $660 = 0, $661 = 0, $662 = 0, $663 = 0;
 var $664 = 0, $665 = 0, $666 = 0, $667 = 0, $668 = 0, $669 = 0, $67 = 0, $670 = 0, $671 = 0, $672 = 0, $673 = 0, $674 = 0, $675 = 0, $676 = 0, $677 = 0, $678 = 0, $679 = 0, $68 = 0, $680 = 0, $681 = 0;
 var $682 = 0, $683 = 0, $684 = 0, $685 = 0, $686 = 0, $687 = 0, $688 = 0, $689 = 0, $69 = 0, $690 = 0, $691 = 0, $692 = 0, $693 = 0, $694 = 0, $695 = 0, $696 = 0, $697 = 0, $698 = 0, $699 = 0, $7 = 0;
 var $70 = 0, $700 = 0, $701 = 0, $702 = 0, $703 = 0, $704 = 0, $705 = 0, $706 = 0, $707 = 0, $708 = 0, $709 = 0, $71 = 0, $710 = 0, $711 = 0, $712 = 0, $713 = 0, $714 = 0, $715 = 0, $716 = 0, $717 = 0;
 var $718 = 0, $719 = 0, $72 = 0, $720 = 0, $721 = 0, $722 = 0, $723 = 0, $724 = 0, $725 = 0, $726 = 0, $727 = 0, $728 = 0, $729 = 0, $73 = 0, $730 = 0, $731 = 0, $732 = 0, $733 = 0, $734 = 0, $735 = 0;
 var $736 = 0, $737 = 0, $738 = 0, $739 = 0, $74 = 0, $740 = 0, $741 = 0, $742 = 0, $743 = 0, $744 = 0, $745 = 0, $746 = 0, $747 = 0, $748 = 0, $749 = 0, $75 = 0, $750 = 0, $751 = 0, $752 = 0, $753 = 0;
 var $754 = 0, $755 = 0, $756 = 0, $757 = 0, $758 = 0, $759 = 0, $76 = 0, $760 = 0, $761 = 0, $762 = 0, $763 = 0, $764 = 0, $765 = 0, $766 = 0, $767 = 0, $768 = 0, $769 = 0, $77 = 0, $770 = 0, $771 = 0;
 var $772 = 0, $773 = 0, $774 = 0, $775 = 0, $776 = 0, $777 = 0, $778 = 0, $779 = 0, $78 = 0, $780 = 0, $781 = 0, $782 = 0, $783 = 0, $784 = 0, $785 = 0, $786 = 0, $787 = 0, $788 = 0, $789 = 0, $79 = 0;
 var $790 = 0, $791 = 0, $792 = 0, $793 = 0, $794 = 0, $795 = 0, $796 = 0, $797 = 0, $798 = 0, $799 = 0, $8 = 0, $80 = 0, $800 = 0, $801 = 0, $802 = 0, $803 = 0, $804 = 0, $805 = 0, $806 = 0, $807 = 0;
 var $808 = 0, $809 = 0, $81 = 0, $810 = 0, $811 = 0, $812 = 0, $813 = 0, $814 = 0, $815 = 0, $816 = 0, $817 = 0, $818 = 0, $819 = 0, $82 = 0, $820 = 0, $821 = 0, $822 = 0, $823 = 0, $824 = 0, $825 = 0;
 var $826 = 0, $827 = 0, $828 = 0, $829 = 0, $83 = 0, $830 = 0, $831 = 0, $832 = 0, $833 = 0, $834 = 0, $835 = 0, $836 = 0, $837 = 0, $838 = 0, $839 = 0, $84 = 0, $840 = 0, $841 = 0, $842 = 0, $843 = 0;
 var $844 = 0, $845 = 0, $846 = 0, $847 = 0, $848 = 0, $849 = 0, $85 = 0, $850 = 0, $851 = 0, $852 = 0, $853 = 0, $854 = 0, $855 = 0, $856 = 0, $857 = 0, $858 = 0, $859 = 0, $86 = 0, $860 = 0, $861 = 0;
 var $862 = 0, $863 = 0, $864 = 0, $865 = 0, $866 = 0, $867 = 0, $868 = 0, $869 = 0, $87 = 0, $870 = 0, $871 = 0, $872 = 0, $873 = 0, $874 = 0, $875 = 0, $876 = 0, $877 = 0, $878 = 0, $879 = 0, $88 = 0;
 var $880 = 0, $881 = 0, $882 = 0, $883 = 0, $884 = 0, $885 = 0, $886 = 0, $887 = 0, $888 = 0, $889 = 0, $89 = 0, $890 = 0, $891 = 0, $892 = 0, $893 = 0, $894 = 0, $895 = 0, $896 = 0, $897 = 0, $898 = 0;
 var $899 = 0, $9 = 0, $90 = 0, $900 = 0, $901 = 0, $902 = 0, $903 = 0, $904 = 0, $905 = 0, $906 = 0, $907 = 0, $908 = 0, $909 = 0, $91 = 0, $910 = 0, $911 = 0, $912 = 0, $913 = 0, $914 = 0, $915 = 0;
 var $916 = 0, $917 = 0, $918 = 0, $919 = 0, $92 = 0, $920 = 0, $921 = 0, $922 = 0, $923 = 0, $924 = 0, $925 = 0, $926 = 0, $927 = 0, $928 = 0, $929 = 0, $93 = 0, $930 = 0, $931 = 0, $932 = 0, $933 = 0;
 var $934 = 0, $935 = 0, $936 = 0, $937 = 0, $938 = 0, $939 = 0, $94 = 0, $940 = 0, $941 = 0, $942 = 0, $943 = 0, $944 = 0, $945 = 0, $946 = 0, $947 = 0, $948 = 0, $949 = 0, $95 = 0, $950 = 0, $951 = 0;
 var $952 = 0, $953 = 0, $954 = 0, $955 = 0, $956 = 0, $957 = 0, $958 = 0, $959 = 0, $96 = 0, $960 = 0, $961 = 0, $962 = 0, $963 = 0, $964 = 0, $965 = 0, $966 = 0, $967 = 0, $968 = 0, $969 = 0, $97 = 0;
 var $970 = 0, $971 = 0, $972 = 0, $973 = 0, $974 = 0, $975 = 0, $976 = 0, $977 = 0, $978 = 0, $979 = 0, $98 = 0, $980 = 0, $981 = 0, $982 = 0, $983 = 0, $984 = 0, $985 = 0, $986 = 0, $987 = 0, $988 = 0;
 var $989 = 0, $99 = 0, $990 = 0, $991 = 0, $992 = 0, $993 = 0, $994 = 0, $995 = 0, $996 = 0, $997 = 0, $998 = 0, $999 = 0, $F$0$i$i = 0, $F1$0$i = 0, $F4$0 = 0, $F4$0$i$i = 0, $F5$0$i = 0, $I1$0$i$i = 0, $I7$0$i = 0, $I7$0$i$i = 0;
 var $K12$0$i = 0, $K2$0$i$i = 0, $K8$0$i$i = 0, $R$1$i = 0, $R$1$i$i = 0, $R$1$i$i$lcssa = 0, $R$1$i$lcssa = 0, $R$1$i9 = 0, $R$1$i9$lcssa = 0, $R$3$i = 0, $R$3$i$i = 0, $R$3$i11 = 0, $RP$1$i = 0, $RP$1$i$i = 0, $RP$1$i$i$lcssa = 0, $RP$1$i$lcssa = 0, $RP$1$i8 = 0, $RP$1$i8$lcssa = 0, $T$0$i = 0, $T$0$i$i = 0;
 var $T$0$i$i$lcssa = 0, $T$0$i$i$lcssa140 = 0, $T$0$i$lcssa = 0, $T$0$i$lcssa156 = 0, $T$0$i18$i = 0, $T$0$i18$i$lcssa = 0, $T$0$i18$i$lcssa139 = 0, $br$2$ph$i = 0, $cond$i = 0, $cond$i$i = 0, $cond$i12 = 0, $exitcond$i$i = 0, $i$01$i$i = 0, $idx$0$i = 0, $nb$0 = 0, $not$$i$i = 0, $not$$i20$i = 0, $not$7$i = 0, $oldfirst$0$i$i = 0, $or$cond$i = 0;
 var $or$cond$i17 = 0, $or$cond1$i = 0, $or$cond1$i16 = 0, $or$cond10$i = 0, $or$cond11$i = 0, $or$cond2$i = 0, $or$cond48$i = 0, $or$cond5$i = 0, $or$cond7$i = 0, $or$cond8$i = 0, $p$0$i$i = 0, $qsize$0$i$i = 0, $rsize$0$i = 0, $rsize$0$i$lcssa = 0, $rsize$0$i5 = 0, $rsize$1$i = 0, $rsize$3$i = 0, $rsize$4$lcssa$i = 0, $rsize$412$i = 0, $rst$0$i = 0;
 var $rst$1$i = 0, $sizebits$0$$i = 0, $sizebits$0$i = 0, $sp$0$i$i = 0, $sp$0$i$i$i = 0, $sp$068$i = 0, $sp$068$i$lcssa = 0, $sp$167$i = 0, $sp$167$i$lcssa = 0, $ssize$0$i = 0, $ssize$2$ph$i = 0, $ssize$5$i = 0, $t$0$i = 0, $t$0$i4 = 0, $t$2$i = 0, $t$4$ph$i = 0, $t$4$v$4$i = 0, $t$411$i = 0, $tbase$746$i = 0, $tsize$745$i = 0;
 var $v$0$i = 0, $v$0$i$lcssa = 0, $v$0$i6 = 0, $v$1$i = 0, $v$3$i = 0, $v$4$lcssa$i = 0, $v$413$i = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ($bytes>>>0)<(245);
 do {
  if ($0) {
   $1 = ($bytes>>>0)<(11);
   $2 = (($bytes) + 11)|0;
   $3 = $2 & -8;
   $4 = $1 ? 16 : $3;
   $5 = $4 >>> 3;
   $6 = HEAP32[11054]|0;
   $7 = $6 >>> $5;
   $8 = $7 & 3;
   $9 = ($8|0)==(0);
   if (!($9)) {
    $10 = $7 & 1;
    $11 = $10 ^ 1;
    $12 = (($11) + ($5))|0;
    $13 = $12 << 1;
    $14 = (44256 + ($13<<2)|0);
    $15 = ((($14)) + 8|0);
    $16 = HEAP32[$15>>2]|0;
    $17 = ((($16)) + 8|0);
    $18 = HEAP32[$17>>2]|0;
    $19 = ($14|0)==($18|0);
    do {
     if ($19) {
      $20 = 1 << $12;
      $21 = $20 ^ -1;
      $22 = $6 & $21;
      HEAP32[11054] = $22;
     } else {
      $23 = HEAP32[(44232)>>2]|0;
      $24 = ($18>>>0)<($23>>>0);
      if ($24) {
       _abort();
       // unreachable;
      }
      $25 = ((($18)) + 12|0);
      $26 = HEAP32[$25>>2]|0;
      $27 = ($26|0)==($16|0);
      if ($27) {
       HEAP32[$25>>2] = $14;
       HEAP32[$15>>2] = $18;
       break;
      } else {
       _abort();
       // unreachable;
      }
     }
    } while(0);
    $28 = $12 << 3;
    $29 = $28 | 3;
    $30 = ((($16)) + 4|0);
    HEAP32[$30>>2] = $29;
    $31 = (($16) + ($28)|0);
    $32 = ((($31)) + 4|0);
    $33 = HEAP32[$32>>2]|0;
    $34 = $33 | 1;
    HEAP32[$32>>2] = $34;
    $$0 = $17;
    return ($$0|0);
   }
   $35 = HEAP32[(44224)>>2]|0;
   $36 = ($4>>>0)>($35>>>0);
   if ($36) {
    $37 = ($7|0)==(0);
    if (!($37)) {
     $38 = $7 << $5;
     $39 = 2 << $5;
     $40 = (0 - ($39))|0;
     $41 = $39 | $40;
     $42 = $38 & $41;
     $43 = (0 - ($42))|0;
     $44 = $42 & $43;
     $45 = (($44) + -1)|0;
     $46 = $45 >>> 12;
     $47 = $46 & 16;
     $48 = $45 >>> $47;
     $49 = $48 >>> 5;
     $50 = $49 & 8;
     $51 = $50 | $47;
     $52 = $48 >>> $50;
     $53 = $52 >>> 2;
     $54 = $53 & 4;
     $55 = $51 | $54;
     $56 = $52 >>> $54;
     $57 = $56 >>> 1;
     $58 = $57 & 2;
     $59 = $55 | $58;
     $60 = $56 >>> $58;
     $61 = $60 >>> 1;
     $62 = $61 & 1;
     $63 = $59 | $62;
     $64 = $60 >>> $62;
     $65 = (($63) + ($64))|0;
     $66 = $65 << 1;
     $67 = (44256 + ($66<<2)|0);
     $68 = ((($67)) + 8|0);
     $69 = HEAP32[$68>>2]|0;
     $70 = ((($69)) + 8|0);
     $71 = HEAP32[$70>>2]|0;
     $72 = ($67|0)==($71|0);
     do {
      if ($72) {
       $73 = 1 << $65;
       $74 = $73 ^ -1;
       $75 = $6 & $74;
       HEAP32[11054] = $75;
       $90 = $35;
      } else {
       $76 = HEAP32[(44232)>>2]|0;
       $77 = ($71>>>0)<($76>>>0);
       if ($77) {
        _abort();
        // unreachable;
       }
       $78 = ((($71)) + 12|0);
       $79 = HEAP32[$78>>2]|0;
       $80 = ($79|0)==($69|0);
       if ($80) {
        HEAP32[$78>>2] = $67;
        HEAP32[$68>>2] = $71;
        $$pre = HEAP32[(44224)>>2]|0;
        $90 = $$pre;
        break;
       } else {
        _abort();
        // unreachable;
       }
      }
     } while(0);
     $81 = $65 << 3;
     $82 = (($81) - ($4))|0;
     $83 = $4 | 3;
     $84 = ((($69)) + 4|0);
     HEAP32[$84>>2] = $83;
     $85 = (($69) + ($4)|0);
     $86 = $82 | 1;
     $87 = ((($85)) + 4|0);
     HEAP32[$87>>2] = $86;
     $88 = (($85) + ($82)|0);
     HEAP32[$88>>2] = $82;
     $89 = ($90|0)==(0);
     if (!($89)) {
      $91 = HEAP32[(44236)>>2]|0;
      $92 = $90 >>> 3;
      $93 = $92 << 1;
      $94 = (44256 + ($93<<2)|0);
      $95 = HEAP32[11054]|0;
      $96 = 1 << $92;
      $97 = $95 & $96;
      $98 = ($97|0)==(0);
      if ($98) {
       $99 = $95 | $96;
       HEAP32[11054] = $99;
       $$pre71 = ((($94)) + 8|0);
       $$pre$phiZ2D = $$pre71;$F4$0 = $94;
      } else {
       $100 = ((($94)) + 8|0);
       $101 = HEAP32[$100>>2]|0;
       $102 = HEAP32[(44232)>>2]|0;
       $103 = ($101>>>0)<($102>>>0);
       if ($103) {
        _abort();
        // unreachable;
       } else {
        $$pre$phiZ2D = $100;$F4$0 = $101;
       }
      }
      HEAP32[$$pre$phiZ2D>>2] = $91;
      $104 = ((($F4$0)) + 12|0);
      HEAP32[$104>>2] = $91;
      $105 = ((($91)) + 8|0);
      HEAP32[$105>>2] = $F4$0;
      $106 = ((($91)) + 12|0);
      HEAP32[$106>>2] = $94;
     }
     HEAP32[(44224)>>2] = $82;
     HEAP32[(44236)>>2] = $85;
     $$0 = $70;
     return ($$0|0);
    }
    $107 = HEAP32[(44220)>>2]|0;
    $108 = ($107|0)==(0);
    if ($108) {
     $nb$0 = $4;
    } else {
     $109 = (0 - ($107))|0;
     $110 = $107 & $109;
     $111 = (($110) + -1)|0;
     $112 = $111 >>> 12;
     $113 = $112 & 16;
     $114 = $111 >>> $113;
     $115 = $114 >>> 5;
     $116 = $115 & 8;
     $117 = $116 | $113;
     $118 = $114 >>> $116;
     $119 = $118 >>> 2;
     $120 = $119 & 4;
     $121 = $117 | $120;
     $122 = $118 >>> $120;
     $123 = $122 >>> 1;
     $124 = $123 & 2;
     $125 = $121 | $124;
     $126 = $122 >>> $124;
     $127 = $126 >>> 1;
     $128 = $127 & 1;
     $129 = $125 | $128;
     $130 = $126 >>> $128;
     $131 = (($129) + ($130))|0;
     $132 = (44520 + ($131<<2)|0);
     $133 = HEAP32[$132>>2]|0;
     $134 = ((($133)) + 4|0);
     $135 = HEAP32[$134>>2]|0;
     $136 = $135 & -8;
     $137 = (($136) - ($4))|0;
     $rsize$0$i = $137;$t$0$i = $133;$v$0$i = $133;
     while(1) {
      $138 = ((($t$0$i)) + 16|0);
      $139 = HEAP32[$138>>2]|0;
      $140 = ($139|0)==(0|0);
      if ($140) {
       $141 = ((($t$0$i)) + 20|0);
       $142 = HEAP32[$141>>2]|0;
       $143 = ($142|0)==(0|0);
       if ($143) {
        $rsize$0$i$lcssa = $rsize$0$i;$v$0$i$lcssa = $v$0$i;
        break;
       } else {
        $145 = $142;
       }
      } else {
       $145 = $139;
      }
      $144 = ((($145)) + 4|0);
      $146 = HEAP32[$144>>2]|0;
      $147 = $146 & -8;
      $148 = (($147) - ($4))|0;
      $149 = ($148>>>0)<($rsize$0$i>>>0);
      $$rsize$0$i = $149 ? $148 : $rsize$0$i;
      $$v$0$i = $149 ? $145 : $v$0$i;
      $rsize$0$i = $$rsize$0$i;$t$0$i = $145;$v$0$i = $$v$0$i;
     }
     $150 = HEAP32[(44232)>>2]|0;
     $151 = ($v$0$i$lcssa>>>0)<($150>>>0);
     if ($151) {
      _abort();
      // unreachable;
     }
     $152 = (($v$0$i$lcssa) + ($4)|0);
     $153 = ($v$0$i$lcssa>>>0)<($152>>>0);
     if (!($153)) {
      _abort();
      // unreachable;
     }
     $154 = ((($v$0$i$lcssa)) + 24|0);
     $155 = HEAP32[$154>>2]|0;
     $156 = ((($v$0$i$lcssa)) + 12|0);
     $157 = HEAP32[$156>>2]|0;
     $158 = ($157|0)==($v$0$i$lcssa|0);
     do {
      if ($158) {
       $168 = ((($v$0$i$lcssa)) + 20|0);
       $169 = HEAP32[$168>>2]|0;
       $170 = ($169|0)==(0|0);
       if ($170) {
        $171 = ((($v$0$i$lcssa)) + 16|0);
        $172 = HEAP32[$171>>2]|0;
        $173 = ($172|0)==(0|0);
        if ($173) {
         $R$3$i = 0;
         break;
        } else {
         $R$1$i = $172;$RP$1$i = $171;
        }
       } else {
        $R$1$i = $169;$RP$1$i = $168;
       }
       while(1) {
        $174 = ((($R$1$i)) + 20|0);
        $175 = HEAP32[$174>>2]|0;
        $176 = ($175|0)==(0|0);
        if (!($176)) {
         $R$1$i = $175;$RP$1$i = $174;
         continue;
        }
        $177 = ((($R$1$i)) + 16|0);
        $178 = HEAP32[$177>>2]|0;
        $179 = ($178|0)==(0|0);
        if ($179) {
         $R$1$i$lcssa = $R$1$i;$RP$1$i$lcssa = $RP$1$i;
         break;
        } else {
         $R$1$i = $178;$RP$1$i = $177;
        }
       }
       $180 = ($RP$1$i$lcssa>>>0)<($150>>>0);
       if ($180) {
        _abort();
        // unreachable;
       } else {
        HEAP32[$RP$1$i$lcssa>>2] = 0;
        $R$3$i = $R$1$i$lcssa;
        break;
       }
      } else {
       $159 = ((($v$0$i$lcssa)) + 8|0);
       $160 = HEAP32[$159>>2]|0;
       $161 = ($160>>>0)<($150>>>0);
       if ($161) {
        _abort();
        // unreachable;
       }
       $162 = ((($160)) + 12|0);
       $163 = HEAP32[$162>>2]|0;
       $164 = ($163|0)==($v$0$i$lcssa|0);
       if (!($164)) {
        _abort();
        // unreachable;
       }
       $165 = ((($157)) + 8|0);
       $166 = HEAP32[$165>>2]|0;
       $167 = ($166|0)==($v$0$i$lcssa|0);
       if ($167) {
        HEAP32[$162>>2] = $157;
        HEAP32[$165>>2] = $160;
        $R$3$i = $157;
        break;
       } else {
        _abort();
        // unreachable;
       }
      }
     } while(0);
     $181 = ($155|0)==(0|0);
     do {
      if (!($181)) {
       $182 = ((($v$0$i$lcssa)) + 28|0);
       $183 = HEAP32[$182>>2]|0;
       $184 = (44520 + ($183<<2)|0);
       $185 = HEAP32[$184>>2]|0;
       $186 = ($v$0$i$lcssa|0)==($185|0);
       if ($186) {
        HEAP32[$184>>2] = $R$3$i;
        $cond$i = ($R$3$i|0)==(0|0);
        if ($cond$i) {
         $187 = 1 << $183;
         $188 = $187 ^ -1;
         $189 = HEAP32[(44220)>>2]|0;
         $190 = $189 & $188;
         HEAP32[(44220)>>2] = $190;
         break;
        }
       } else {
        $191 = HEAP32[(44232)>>2]|0;
        $192 = ($155>>>0)<($191>>>0);
        if ($192) {
         _abort();
         // unreachable;
        }
        $193 = ((($155)) + 16|0);
        $194 = HEAP32[$193>>2]|0;
        $195 = ($194|0)==($v$0$i$lcssa|0);
        if ($195) {
         HEAP32[$193>>2] = $R$3$i;
        } else {
         $196 = ((($155)) + 20|0);
         HEAP32[$196>>2] = $R$3$i;
        }
        $197 = ($R$3$i|0)==(0|0);
        if ($197) {
         break;
        }
       }
       $198 = HEAP32[(44232)>>2]|0;
       $199 = ($R$3$i>>>0)<($198>>>0);
       if ($199) {
        _abort();
        // unreachable;
       }
       $200 = ((($R$3$i)) + 24|0);
       HEAP32[$200>>2] = $155;
       $201 = ((($v$0$i$lcssa)) + 16|0);
       $202 = HEAP32[$201>>2]|0;
       $203 = ($202|0)==(0|0);
       do {
        if (!($203)) {
         $204 = ($202>>>0)<($198>>>0);
         if ($204) {
          _abort();
          // unreachable;
         } else {
          $205 = ((($R$3$i)) + 16|0);
          HEAP32[$205>>2] = $202;
          $206 = ((($202)) + 24|0);
          HEAP32[$206>>2] = $R$3$i;
          break;
         }
        }
       } while(0);
       $207 = ((($v$0$i$lcssa)) + 20|0);
       $208 = HEAP32[$207>>2]|0;
       $209 = ($208|0)==(0|0);
       if (!($209)) {
        $210 = HEAP32[(44232)>>2]|0;
        $211 = ($208>>>0)<($210>>>0);
        if ($211) {
         _abort();
         // unreachable;
        } else {
         $212 = ((($R$3$i)) + 20|0);
         HEAP32[$212>>2] = $208;
         $213 = ((($208)) + 24|0);
         HEAP32[$213>>2] = $R$3$i;
         break;
        }
       }
      }
     } while(0);
     $214 = ($rsize$0$i$lcssa>>>0)<(16);
     if ($214) {
      $215 = (($rsize$0$i$lcssa) + ($4))|0;
      $216 = $215 | 3;
      $217 = ((($v$0$i$lcssa)) + 4|0);
      HEAP32[$217>>2] = $216;
      $218 = (($v$0$i$lcssa) + ($215)|0);
      $219 = ((($218)) + 4|0);
      $220 = HEAP32[$219>>2]|0;
      $221 = $220 | 1;
      HEAP32[$219>>2] = $221;
     } else {
      $222 = $4 | 3;
      $223 = ((($v$0$i$lcssa)) + 4|0);
      HEAP32[$223>>2] = $222;
      $224 = $rsize$0$i$lcssa | 1;
      $225 = ((($152)) + 4|0);
      HEAP32[$225>>2] = $224;
      $226 = (($152) + ($rsize$0$i$lcssa)|0);
      HEAP32[$226>>2] = $rsize$0$i$lcssa;
      $227 = HEAP32[(44224)>>2]|0;
      $228 = ($227|0)==(0);
      if (!($228)) {
       $229 = HEAP32[(44236)>>2]|0;
       $230 = $227 >>> 3;
       $231 = $230 << 1;
       $232 = (44256 + ($231<<2)|0);
       $233 = HEAP32[11054]|0;
       $234 = 1 << $230;
       $235 = $233 & $234;
       $236 = ($235|0)==(0);
       if ($236) {
        $237 = $233 | $234;
        HEAP32[11054] = $237;
        $$pre$i = ((($232)) + 8|0);
        $$pre$phi$iZ2D = $$pre$i;$F1$0$i = $232;
       } else {
        $238 = ((($232)) + 8|0);
        $239 = HEAP32[$238>>2]|0;
        $240 = HEAP32[(44232)>>2]|0;
        $241 = ($239>>>0)<($240>>>0);
        if ($241) {
         _abort();
         // unreachable;
        } else {
         $$pre$phi$iZ2D = $238;$F1$0$i = $239;
        }
       }
       HEAP32[$$pre$phi$iZ2D>>2] = $229;
       $242 = ((($F1$0$i)) + 12|0);
       HEAP32[$242>>2] = $229;
       $243 = ((($229)) + 8|0);
       HEAP32[$243>>2] = $F1$0$i;
       $244 = ((($229)) + 12|0);
       HEAP32[$244>>2] = $232;
      }
      HEAP32[(44224)>>2] = $rsize$0$i$lcssa;
      HEAP32[(44236)>>2] = $152;
     }
     $245 = ((($v$0$i$lcssa)) + 8|0);
     $$0 = $245;
     return ($$0|0);
    }
   } else {
    $nb$0 = $4;
   }
  } else {
   $246 = ($bytes>>>0)>(4294967231);
   if ($246) {
    $nb$0 = -1;
   } else {
    $247 = (($bytes) + 11)|0;
    $248 = $247 & -8;
    $249 = HEAP32[(44220)>>2]|0;
    $250 = ($249|0)==(0);
    if ($250) {
     $nb$0 = $248;
    } else {
     $251 = (0 - ($248))|0;
     $252 = $247 >>> 8;
     $253 = ($252|0)==(0);
     if ($253) {
      $idx$0$i = 0;
     } else {
      $254 = ($248>>>0)>(16777215);
      if ($254) {
       $idx$0$i = 31;
      } else {
       $255 = (($252) + 1048320)|0;
       $256 = $255 >>> 16;
       $257 = $256 & 8;
       $258 = $252 << $257;
       $259 = (($258) + 520192)|0;
       $260 = $259 >>> 16;
       $261 = $260 & 4;
       $262 = $261 | $257;
       $263 = $258 << $261;
       $264 = (($263) + 245760)|0;
       $265 = $264 >>> 16;
       $266 = $265 & 2;
       $267 = $262 | $266;
       $268 = (14 - ($267))|0;
       $269 = $263 << $266;
       $270 = $269 >>> 15;
       $271 = (($268) + ($270))|0;
       $272 = $271 << 1;
       $273 = (($271) + 7)|0;
       $274 = $248 >>> $273;
       $275 = $274 & 1;
       $276 = $275 | $272;
       $idx$0$i = $276;
      }
     }
     $277 = (44520 + ($idx$0$i<<2)|0);
     $278 = HEAP32[$277>>2]|0;
     $279 = ($278|0)==(0|0);
     L123: do {
      if ($279) {
       $rsize$3$i = $251;$t$2$i = 0;$v$3$i = 0;
       label = 86;
      } else {
       $280 = ($idx$0$i|0)==(31);
       $281 = $idx$0$i >>> 1;
       $282 = (25 - ($281))|0;
       $283 = $280 ? 0 : $282;
       $284 = $248 << $283;
       $rsize$0$i5 = $251;$rst$0$i = 0;$sizebits$0$i = $284;$t$0$i4 = $278;$v$0$i6 = 0;
       while(1) {
        $285 = ((($t$0$i4)) + 4|0);
        $286 = HEAP32[$285>>2]|0;
        $287 = $286 & -8;
        $288 = (($287) - ($248))|0;
        $289 = ($288>>>0)<($rsize$0$i5>>>0);
        if ($289) {
         $290 = ($287|0)==($248|0);
         if ($290) {
          $rsize$412$i = $288;$t$411$i = $t$0$i4;$v$413$i = $t$0$i4;
          label = 90;
          break L123;
         } else {
          $rsize$1$i = $288;$v$1$i = $t$0$i4;
         }
        } else {
         $rsize$1$i = $rsize$0$i5;$v$1$i = $v$0$i6;
        }
        $291 = ((($t$0$i4)) + 20|0);
        $292 = HEAP32[$291>>2]|0;
        $293 = $sizebits$0$i >>> 31;
        $294 = (((($t$0$i4)) + 16|0) + ($293<<2)|0);
        $295 = HEAP32[$294>>2]|0;
        $296 = ($292|0)==(0|0);
        $297 = ($292|0)==($295|0);
        $or$cond1$i = $296 | $297;
        $rst$1$i = $or$cond1$i ? $rst$0$i : $292;
        $298 = ($295|0)==(0|0);
        $299 = $298&1;
        $300 = $299 ^ 1;
        $sizebits$0$$i = $sizebits$0$i << $300;
        if ($298) {
         $rsize$3$i = $rsize$1$i;$t$2$i = $rst$1$i;$v$3$i = $v$1$i;
         label = 86;
         break;
        } else {
         $rsize$0$i5 = $rsize$1$i;$rst$0$i = $rst$1$i;$sizebits$0$i = $sizebits$0$$i;$t$0$i4 = $295;$v$0$i6 = $v$1$i;
        }
       }
      }
     } while(0);
     if ((label|0) == 86) {
      $301 = ($t$2$i|0)==(0|0);
      $302 = ($v$3$i|0)==(0|0);
      $or$cond$i = $301 & $302;
      if ($or$cond$i) {
       $303 = 2 << $idx$0$i;
       $304 = (0 - ($303))|0;
       $305 = $303 | $304;
       $306 = $249 & $305;
       $307 = ($306|0)==(0);
       if ($307) {
        $nb$0 = $248;
        break;
       }
       $308 = (0 - ($306))|0;
       $309 = $306 & $308;
       $310 = (($309) + -1)|0;
       $311 = $310 >>> 12;
       $312 = $311 & 16;
       $313 = $310 >>> $312;
       $314 = $313 >>> 5;
       $315 = $314 & 8;
       $316 = $315 | $312;
       $317 = $313 >>> $315;
       $318 = $317 >>> 2;
       $319 = $318 & 4;
       $320 = $316 | $319;
       $321 = $317 >>> $319;
       $322 = $321 >>> 1;
       $323 = $322 & 2;
       $324 = $320 | $323;
       $325 = $321 >>> $323;
       $326 = $325 >>> 1;
       $327 = $326 & 1;
       $328 = $324 | $327;
       $329 = $325 >>> $327;
       $330 = (($328) + ($329))|0;
       $331 = (44520 + ($330<<2)|0);
       $332 = HEAP32[$331>>2]|0;
       $t$4$ph$i = $332;
      } else {
       $t$4$ph$i = $t$2$i;
      }
      $333 = ($t$4$ph$i|0)==(0|0);
      if ($333) {
       $rsize$4$lcssa$i = $rsize$3$i;$v$4$lcssa$i = $v$3$i;
      } else {
       $rsize$412$i = $rsize$3$i;$t$411$i = $t$4$ph$i;$v$413$i = $v$3$i;
       label = 90;
      }
     }
     if ((label|0) == 90) {
      while(1) {
       label = 0;
       $334 = ((($t$411$i)) + 4|0);
       $335 = HEAP32[$334>>2]|0;
       $336 = $335 & -8;
       $337 = (($336) - ($248))|0;
       $338 = ($337>>>0)<($rsize$412$i>>>0);
       $$rsize$4$i = $338 ? $337 : $rsize$412$i;
       $t$4$v$4$i = $338 ? $t$411$i : $v$413$i;
       $339 = ((($t$411$i)) + 16|0);
       $340 = HEAP32[$339>>2]|0;
       $341 = ($340|0)==(0|0);
       if (!($341)) {
        $rsize$412$i = $$rsize$4$i;$t$411$i = $340;$v$413$i = $t$4$v$4$i;
        label = 90;
        continue;
       }
       $342 = ((($t$411$i)) + 20|0);
       $343 = HEAP32[$342>>2]|0;
       $344 = ($343|0)==(0|0);
       if ($344) {
        $rsize$4$lcssa$i = $$rsize$4$i;$v$4$lcssa$i = $t$4$v$4$i;
        break;
       } else {
        $rsize$412$i = $$rsize$4$i;$t$411$i = $343;$v$413$i = $t$4$v$4$i;
        label = 90;
       }
      }
     }
     $345 = ($v$4$lcssa$i|0)==(0|0);
     if ($345) {
      $nb$0 = $248;
     } else {
      $346 = HEAP32[(44224)>>2]|0;
      $347 = (($346) - ($248))|0;
      $348 = ($rsize$4$lcssa$i>>>0)<($347>>>0);
      if ($348) {
       $349 = HEAP32[(44232)>>2]|0;
       $350 = ($v$4$lcssa$i>>>0)<($349>>>0);
       if ($350) {
        _abort();
        // unreachable;
       }
       $351 = (($v$4$lcssa$i) + ($248)|0);
       $352 = ($v$4$lcssa$i>>>0)<($351>>>0);
       if (!($352)) {
        _abort();
        // unreachable;
       }
       $353 = ((($v$4$lcssa$i)) + 24|0);
       $354 = HEAP32[$353>>2]|0;
       $355 = ((($v$4$lcssa$i)) + 12|0);
       $356 = HEAP32[$355>>2]|0;
       $357 = ($356|0)==($v$4$lcssa$i|0);
       do {
        if ($357) {
         $367 = ((($v$4$lcssa$i)) + 20|0);
         $368 = HEAP32[$367>>2]|0;
         $369 = ($368|0)==(0|0);
         if ($369) {
          $370 = ((($v$4$lcssa$i)) + 16|0);
          $371 = HEAP32[$370>>2]|0;
          $372 = ($371|0)==(0|0);
          if ($372) {
           $R$3$i11 = 0;
           break;
          } else {
           $R$1$i9 = $371;$RP$1$i8 = $370;
          }
         } else {
          $R$1$i9 = $368;$RP$1$i8 = $367;
         }
         while(1) {
          $373 = ((($R$1$i9)) + 20|0);
          $374 = HEAP32[$373>>2]|0;
          $375 = ($374|0)==(0|0);
          if (!($375)) {
           $R$1$i9 = $374;$RP$1$i8 = $373;
           continue;
          }
          $376 = ((($R$1$i9)) + 16|0);
          $377 = HEAP32[$376>>2]|0;
          $378 = ($377|0)==(0|0);
          if ($378) {
           $R$1$i9$lcssa = $R$1$i9;$RP$1$i8$lcssa = $RP$1$i8;
           break;
          } else {
           $R$1$i9 = $377;$RP$1$i8 = $376;
          }
         }
         $379 = ($RP$1$i8$lcssa>>>0)<($349>>>0);
         if ($379) {
          _abort();
          // unreachable;
         } else {
          HEAP32[$RP$1$i8$lcssa>>2] = 0;
          $R$3$i11 = $R$1$i9$lcssa;
          break;
         }
        } else {
         $358 = ((($v$4$lcssa$i)) + 8|0);
         $359 = HEAP32[$358>>2]|0;
         $360 = ($359>>>0)<($349>>>0);
         if ($360) {
          _abort();
          // unreachable;
         }
         $361 = ((($359)) + 12|0);
         $362 = HEAP32[$361>>2]|0;
         $363 = ($362|0)==($v$4$lcssa$i|0);
         if (!($363)) {
          _abort();
          // unreachable;
         }
         $364 = ((($356)) + 8|0);
         $365 = HEAP32[$364>>2]|0;
         $366 = ($365|0)==($v$4$lcssa$i|0);
         if ($366) {
          HEAP32[$361>>2] = $356;
          HEAP32[$364>>2] = $359;
          $R$3$i11 = $356;
          break;
         } else {
          _abort();
          // unreachable;
         }
        }
       } while(0);
       $380 = ($354|0)==(0|0);
       do {
        if (!($380)) {
         $381 = ((($v$4$lcssa$i)) + 28|0);
         $382 = HEAP32[$381>>2]|0;
         $383 = (44520 + ($382<<2)|0);
         $384 = HEAP32[$383>>2]|0;
         $385 = ($v$4$lcssa$i|0)==($384|0);
         if ($385) {
          HEAP32[$383>>2] = $R$3$i11;
          $cond$i12 = ($R$3$i11|0)==(0|0);
          if ($cond$i12) {
           $386 = 1 << $382;
           $387 = $386 ^ -1;
           $388 = HEAP32[(44220)>>2]|0;
           $389 = $388 & $387;
           HEAP32[(44220)>>2] = $389;
           break;
          }
         } else {
          $390 = HEAP32[(44232)>>2]|0;
          $391 = ($354>>>0)<($390>>>0);
          if ($391) {
           _abort();
           // unreachable;
          }
          $392 = ((($354)) + 16|0);
          $393 = HEAP32[$392>>2]|0;
          $394 = ($393|0)==($v$4$lcssa$i|0);
          if ($394) {
           HEAP32[$392>>2] = $R$3$i11;
          } else {
           $395 = ((($354)) + 20|0);
           HEAP32[$395>>2] = $R$3$i11;
          }
          $396 = ($R$3$i11|0)==(0|0);
          if ($396) {
           break;
          }
         }
         $397 = HEAP32[(44232)>>2]|0;
         $398 = ($R$3$i11>>>0)<($397>>>0);
         if ($398) {
          _abort();
          // unreachable;
         }
         $399 = ((($R$3$i11)) + 24|0);
         HEAP32[$399>>2] = $354;
         $400 = ((($v$4$lcssa$i)) + 16|0);
         $401 = HEAP32[$400>>2]|0;
         $402 = ($401|0)==(0|0);
         do {
          if (!($402)) {
           $403 = ($401>>>0)<($397>>>0);
           if ($403) {
            _abort();
            // unreachable;
           } else {
            $404 = ((($R$3$i11)) + 16|0);
            HEAP32[$404>>2] = $401;
            $405 = ((($401)) + 24|0);
            HEAP32[$405>>2] = $R$3$i11;
            break;
           }
          }
         } while(0);
         $406 = ((($v$4$lcssa$i)) + 20|0);
         $407 = HEAP32[$406>>2]|0;
         $408 = ($407|0)==(0|0);
         if (!($408)) {
          $409 = HEAP32[(44232)>>2]|0;
          $410 = ($407>>>0)<($409>>>0);
          if ($410) {
           _abort();
           // unreachable;
          } else {
           $411 = ((($R$3$i11)) + 20|0);
           HEAP32[$411>>2] = $407;
           $412 = ((($407)) + 24|0);
           HEAP32[$412>>2] = $R$3$i11;
           break;
          }
         }
        }
       } while(0);
       $413 = ($rsize$4$lcssa$i>>>0)<(16);
       do {
        if ($413) {
         $414 = (($rsize$4$lcssa$i) + ($248))|0;
         $415 = $414 | 3;
         $416 = ((($v$4$lcssa$i)) + 4|0);
         HEAP32[$416>>2] = $415;
         $417 = (($v$4$lcssa$i) + ($414)|0);
         $418 = ((($417)) + 4|0);
         $419 = HEAP32[$418>>2]|0;
         $420 = $419 | 1;
         HEAP32[$418>>2] = $420;
        } else {
         $421 = $248 | 3;
         $422 = ((($v$4$lcssa$i)) + 4|0);
         HEAP32[$422>>2] = $421;
         $423 = $rsize$4$lcssa$i | 1;
         $424 = ((($351)) + 4|0);
         HEAP32[$424>>2] = $423;
         $425 = (($351) + ($rsize$4$lcssa$i)|0);
         HEAP32[$425>>2] = $rsize$4$lcssa$i;
         $426 = $rsize$4$lcssa$i >>> 3;
         $427 = ($rsize$4$lcssa$i>>>0)<(256);
         if ($427) {
          $428 = $426 << 1;
          $429 = (44256 + ($428<<2)|0);
          $430 = HEAP32[11054]|0;
          $431 = 1 << $426;
          $432 = $430 & $431;
          $433 = ($432|0)==(0);
          if ($433) {
           $434 = $430 | $431;
           HEAP32[11054] = $434;
           $$pre$i13 = ((($429)) + 8|0);
           $$pre$phi$i14Z2D = $$pre$i13;$F5$0$i = $429;
          } else {
           $435 = ((($429)) + 8|0);
           $436 = HEAP32[$435>>2]|0;
           $437 = HEAP32[(44232)>>2]|0;
           $438 = ($436>>>0)<($437>>>0);
           if ($438) {
            _abort();
            // unreachable;
           } else {
            $$pre$phi$i14Z2D = $435;$F5$0$i = $436;
           }
          }
          HEAP32[$$pre$phi$i14Z2D>>2] = $351;
          $439 = ((($F5$0$i)) + 12|0);
          HEAP32[$439>>2] = $351;
          $440 = ((($351)) + 8|0);
          HEAP32[$440>>2] = $F5$0$i;
          $441 = ((($351)) + 12|0);
          HEAP32[$441>>2] = $429;
          break;
         }
         $442 = $rsize$4$lcssa$i >>> 8;
         $443 = ($442|0)==(0);
         if ($443) {
          $I7$0$i = 0;
         } else {
          $444 = ($rsize$4$lcssa$i>>>0)>(16777215);
          if ($444) {
           $I7$0$i = 31;
          } else {
           $445 = (($442) + 1048320)|0;
           $446 = $445 >>> 16;
           $447 = $446 & 8;
           $448 = $442 << $447;
           $449 = (($448) + 520192)|0;
           $450 = $449 >>> 16;
           $451 = $450 & 4;
           $452 = $451 | $447;
           $453 = $448 << $451;
           $454 = (($453) + 245760)|0;
           $455 = $454 >>> 16;
           $456 = $455 & 2;
           $457 = $452 | $456;
           $458 = (14 - ($457))|0;
           $459 = $453 << $456;
           $460 = $459 >>> 15;
           $461 = (($458) + ($460))|0;
           $462 = $461 << 1;
           $463 = (($461) + 7)|0;
           $464 = $rsize$4$lcssa$i >>> $463;
           $465 = $464 & 1;
           $466 = $465 | $462;
           $I7$0$i = $466;
          }
         }
         $467 = (44520 + ($I7$0$i<<2)|0);
         $468 = ((($351)) + 28|0);
         HEAP32[$468>>2] = $I7$0$i;
         $469 = ((($351)) + 16|0);
         $470 = ((($469)) + 4|0);
         HEAP32[$470>>2] = 0;
         HEAP32[$469>>2] = 0;
         $471 = HEAP32[(44220)>>2]|0;
         $472 = 1 << $I7$0$i;
         $473 = $471 & $472;
         $474 = ($473|0)==(0);
         if ($474) {
          $475 = $471 | $472;
          HEAP32[(44220)>>2] = $475;
          HEAP32[$467>>2] = $351;
          $476 = ((($351)) + 24|0);
          HEAP32[$476>>2] = $467;
          $477 = ((($351)) + 12|0);
          HEAP32[$477>>2] = $351;
          $478 = ((($351)) + 8|0);
          HEAP32[$478>>2] = $351;
          break;
         }
         $479 = HEAP32[$467>>2]|0;
         $480 = ($I7$0$i|0)==(31);
         $481 = $I7$0$i >>> 1;
         $482 = (25 - ($481))|0;
         $483 = $480 ? 0 : $482;
         $484 = $rsize$4$lcssa$i << $483;
         $K12$0$i = $484;$T$0$i = $479;
         while(1) {
          $485 = ((($T$0$i)) + 4|0);
          $486 = HEAP32[$485>>2]|0;
          $487 = $486 & -8;
          $488 = ($487|0)==($rsize$4$lcssa$i|0);
          if ($488) {
           $T$0$i$lcssa = $T$0$i;
           label = 148;
           break;
          }
          $489 = $K12$0$i >>> 31;
          $490 = (((($T$0$i)) + 16|0) + ($489<<2)|0);
          $491 = $K12$0$i << 1;
          $492 = HEAP32[$490>>2]|0;
          $493 = ($492|0)==(0|0);
          if ($493) {
           $$lcssa157 = $490;$T$0$i$lcssa156 = $T$0$i;
           label = 145;
           break;
          } else {
           $K12$0$i = $491;$T$0$i = $492;
          }
         }
         if ((label|0) == 145) {
          $494 = HEAP32[(44232)>>2]|0;
          $495 = ($$lcssa157>>>0)<($494>>>0);
          if ($495) {
           _abort();
           // unreachable;
          } else {
           HEAP32[$$lcssa157>>2] = $351;
           $496 = ((($351)) + 24|0);
           HEAP32[$496>>2] = $T$0$i$lcssa156;
           $497 = ((($351)) + 12|0);
           HEAP32[$497>>2] = $351;
           $498 = ((($351)) + 8|0);
           HEAP32[$498>>2] = $351;
           break;
          }
         }
         else if ((label|0) == 148) {
          $499 = ((($T$0$i$lcssa)) + 8|0);
          $500 = HEAP32[$499>>2]|0;
          $501 = HEAP32[(44232)>>2]|0;
          $502 = ($500>>>0)>=($501>>>0);
          $not$7$i = ($T$0$i$lcssa>>>0)>=($501>>>0);
          $503 = $502 & $not$7$i;
          if ($503) {
           $504 = ((($500)) + 12|0);
           HEAP32[$504>>2] = $351;
           HEAP32[$499>>2] = $351;
           $505 = ((($351)) + 8|0);
           HEAP32[$505>>2] = $500;
           $506 = ((($351)) + 12|0);
           HEAP32[$506>>2] = $T$0$i$lcssa;
           $507 = ((($351)) + 24|0);
           HEAP32[$507>>2] = 0;
           break;
          } else {
           _abort();
           // unreachable;
          }
         }
        }
       } while(0);
       $508 = ((($v$4$lcssa$i)) + 8|0);
       $$0 = $508;
       return ($$0|0);
      } else {
       $nb$0 = $248;
      }
     }
    }
   }
  }
 } while(0);
 $509 = HEAP32[(44224)>>2]|0;
 $510 = ($509>>>0)<($nb$0>>>0);
 if (!($510)) {
  $511 = (($509) - ($nb$0))|0;
  $512 = HEAP32[(44236)>>2]|0;
  $513 = ($511>>>0)>(15);
  if ($513) {
   $514 = (($512) + ($nb$0)|0);
   HEAP32[(44236)>>2] = $514;
   HEAP32[(44224)>>2] = $511;
   $515 = $511 | 1;
   $516 = ((($514)) + 4|0);
   HEAP32[$516>>2] = $515;
   $517 = (($514) + ($511)|0);
   HEAP32[$517>>2] = $511;
   $518 = $nb$0 | 3;
   $519 = ((($512)) + 4|0);
   HEAP32[$519>>2] = $518;
  } else {
   HEAP32[(44224)>>2] = 0;
   HEAP32[(44236)>>2] = 0;
   $520 = $509 | 3;
   $521 = ((($512)) + 4|0);
   HEAP32[$521>>2] = $520;
   $522 = (($512) + ($509)|0);
   $523 = ((($522)) + 4|0);
   $524 = HEAP32[$523>>2]|0;
   $525 = $524 | 1;
   HEAP32[$523>>2] = $525;
  }
  $526 = ((($512)) + 8|0);
  $$0 = $526;
  return ($$0|0);
 }
 $527 = HEAP32[(44228)>>2]|0;
 $528 = ($527>>>0)>($nb$0>>>0);
 if ($528) {
  $529 = (($527) - ($nb$0))|0;
  HEAP32[(44228)>>2] = $529;
  $530 = HEAP32[(44240)>>2]|0;
  $531 = (($530) + ($nb$0)|0);
  HEAP32[(44240)>>2] = $531;
  $532 = $529 | 1;
  $533 = ((($531)) + 4|0);
  HEAP32[$533>>2] = $532;
  $534 = $nb$0 | 3;
  $535 = ((($530)) + 4|0);
  HEAP32[$535>>2] = $534;
  $536 = ((($530)) + 8|0);
  $$0 = $536;
  return ($$0|0);
 }
 $537 = HEAP32[11172]|0;
 $538 = ($537|0)==(0);
 do {
  if ($538) {
   $539 = (_sysconf(30)|0);
   $540 = (($539) + -1)|0;
   $541 = $540 & $539;
   $542 = ($541|0)==(0);
   if ($542) {
    HEAP32[(44696)>>2] = $539;
    HEAP32[(44692)>>2] = $539;
    HEAP32[(44700)>>2] = -1;
    HEAP32[(44704)>>2] = -1;
    HEAP32[(44708)>>2] = 0;
    HEAP32[(44660)>>2] = 0;
    $543 = (_time((0|0))|0);
    $544 = $543 & -16;
    $545 = $544 ^ 1431655768;
    HEAP32[11172] = $545;
    break;
   } else {
    _abort();
    // unreachable;
   }
  }
 } while(0);
 $546 = (($nb$0) + 48)|0;
 $547 = HEAP32[(44696)>>2]|0;
 $548 = (($nb$0) + 47)|0;
 $549 = (($547) + ($548))|0;
 $550 = (0 - ($547))|0;
 $551 = $549 & $550;
 $552 = ($551>>>0)>($nb$0>>>0);
 if (!($552)) {
  $$0 = 0;
  return ($$0|0);
 }
 $553 = HEAP32[(44656)>>2]|0;
 $554 = ($553|0)==(0);
 if (!($554)) {
  $555 = HEAP32[(44648)>>2]|0;
  $556 = (($555) + ($551))|0;
  $557 = ($556>>>0)<=($555>>>0);
  $558 = ($556>>>0)>($553>>>0);
  $or$cond1$i16 = $557 | $558;
  if ($or$cond1$i16) {
   $$0 = 0;
   return ($$0|0);
  }
 }
 $559 = HEAP32[(44660)>>2]|0;
 $560 = $559 & 4;
 $561 = ($560|0)==(0);
 L257: do {
  if ($561) {
   $562 = HEAP32[(44240)>>2]|0;
   $563 = ($562|0)==(0|0);
   L259: do {
    if ($563) {
     label = 173;
    } else {
     $sp$0$i$i = (44664);
     while(1) {
      $564 = HEAP32[$sp$0$i$i>>2]|0;
      $565 = ($564>>>0)>($562>>>0);
      if (!($565)) {
       $566 = ((($sp$0$i$i)) + 4|0);
       $567 = HEAP32[$566>>2]|0;
       $568 = (($564) + ($567)|0);
       $569 = ($568>>>0)>($562>>>0);
       if ($569) {
        $$lcssa153 = $sp$0$i$i;$$lcssa155 = $566;
        break;
       }
      }
      $570 = ((($sp$0$i$i)) + 8|0);
      $571 = HEAP32[$570>>2]|0;
      $572 = ($571|0)==(0|0);
      if ($572) {
       label = 173;
       break L259;
      } else {
       $sp$0$i$i = $571;
      }
     }
     $595 = HEAP32[(44228)>>2]|0;
     $596 = (($549) - ($595))|0;
     $597 = $596 & $550;
     $598 = ($597>>>0)<(2147483647);
     if ($598) {
      $599 = (_sbrk(($597|0))|0);
      $600 = HEAP32[$$lcssa153>>2]|0;
      $601 = HEAP32[$$lcssa155>>2]|0;
      $602 = (($600) + ($601)|0);
      $603 = ($599|0)==($602|0);
      if ($603) {
       $604 = ($599|0)==((-1)|0);
       if (!($604)) {
        $tbase$746$i = $599;$tsize$745$i = $597;
        label = 193;
        break L257;
       }
      } else {
       $br$2$ph$i = $599;$ssize$2$ph$i = $597;
       label = 183;
      }
     }
    }
   } while(0);
   do {
    if ((label|0) == 173) {
     $573 = (_sbrk(0)|0);
     $574 = ($573|0)==((-1)|0);
     if (!($574)) {
      $575 = $573;
      $576 = HEAP32[(44692)>>2]|0;
      $577 = (($576) + -1)|0;
      $578 = $577 & $575;
      $579 = ($578|0)==(0);
      if ($579) {
       $ssize$0$i = $551;
      } else {
       $580 = (($577) + ($575))|0;
       $581 = (0 - ($576))|0;
       $582 = $580 & $581;
       $583 = (($551) - ($575))|0;
       $584 = (($583) + ($582))|0;
       $ssize$0$i = $584;
      }
      $585 = HEAP32[(44648)>>2]|0;
      $586 = (($585) + ($ssize$0$i))|0;
      $587 = ($ssize$0$i>>>0)>($nb$0>>>0);
      $588 = ($ssize$0$i>>>0)<(2147483647);
      $or$cond$i17 = $587 & $588;
      if ($or$cond$i17) {
       $589 = HEAP32[(44656)>>2]|0;
       $590 = ($589|0)==(0);
       if (!($590)) {
        $591 = ($586>>>0)<=($585>>>0);
        $592 = ($586>>>0)>($589>>>0);
        $or$cond2$i = $591 | $592;
        if ($or$cond2$i) {
         break;
        }
       }
       $593 = (_sbrk(($ssize$0$i|0))|0);
       $594 = ($593|0)==($573|0);
       if ($594) {
        $tbase$746$i = $573;$tsize$745$i = $ssize$0$i;
        label = 193;
        break L257;
       } else {
        $br$2$ph$i = $593;$ssize$2$ph$i = $ssize$0$i;
        label = 183;
       }
      }
     }
    }
   } while(0);
   L279: do {
    if ((label|0) == 183) {
     $605 = (0 - ($ssize$2$ph$i))|0;
     $606 = ($br$2$ph$i|0)!=((-1)|0);
     $607 = ($ssize$2$ph$i>>>0)<(2147483647);
     $or$cond7$i = $607 & $606;
     $608 = ($546>>>0)>($ssize$2$ph$i>>>0);
     $or$cond8$i = $608 & $or$cond7$i;
     do {
      if ($or$cond8$i) {
       $609 = HEAP32[(44696)>>2]|0;
       $610 = (($548) - ($ssize$2$ph$i))|0;
       $611 = (($610) + ($609))|0;
       $612 = (0 - ($609))|0;
       $613 = $611 & $612;
       $614 = ($613>>>0)<(2147483647);
       if ($614) {
        $615 = (_sbrk(($613|0))|0);
        $616 = ($615|0)==((-1)|0);
        if ($616) {
         (_sbrk(($605|0))|0);
         break L279;
        } else {
         $617 = (($613) + ($ssize$2$ph$i))|0;
         $ssize$5$i = $617;
         break;
        }
       } else {
        $ssize$5$i = $ssize$2$ph$i;
       }
      } else {
       $ssize$5$i = $ssize$2$ph$i;
      }
     } while(0);
     $618 = ($br$2$ph$i|0)==((-1)|0);
     if (!($618)) {
      $tbase$746$i = $br$2$ph$i;$tsize$745$i = $ssize$5$i;
      label = 193;
      break L257;
     }
    }
   } while(0);
   $619 = HEAP32[(44660)>>2]|0;
   $620 = $619 | 4;
   HEAP32[(44660)>>2] = $620;
   label = 190;
  } else {
   label = 190;
  }
 } while(0);
 if ((label|0) == 190) {
  $621 = ($551>>>0)<(2147483647);
  if ($621) {
   $622 = (_sbrk(($551|0))|0);
   $623 = (_sbrk(0)|0);
   $624 = ($622|0)!=((-1)|0);
   $625 = ($623|0)!=((-1)|0);
   $or$cond5$i = $624 & $625;
   $626 = ($622>>>0)<($623>>>0);
   $or$cond10$i = $626 & $or$cond5$i;
   if ($or$cond10$i) {
    $627 = $623;
    $628 = $622;
    $629 = (($627) - ($628))|0;
    $630 = (($nb$0) + 40)|0;
    $$not$i = ($629>>>0)>($630>>>0);
    if ($$not$i) {
     $tbase$746$i = $622;$tsize$745$i = $629;
     label = 193;
    }
   }
  }
 }
 if ((label|0) == 193) {
  $631 = HEAP32[(44648)>>2]|0;
  $632 = (($631) + ($tsize$745$i))|0;
  HEAP32[(44648)>>2] = $632;
  $633 = HEAP32[(44652)>>2]|0;
  $634 = ($632>>>0)>($633>>>0);
  if ($634) {
   HEAP32[(44652)>>2] = $632;
  }
  $635 = HEAP32[(44240)>>2]|0;
  $636 = ($635|0)==(0|0);
  do {
   if ($636) {
    $637 = HEAP32[(44232)>>2]|0;
    $638 = ($637|0)==(0|0);
    $639 = ($tbase$746$i>>>0)<($637>>>0);
    $or$cond11$i = $638 | $639;
    if ($or$cond11$i) {
     HEAP32[(44232)>>2] = $tbase$746$i;
    }
    HEAP32[(44664)>>2] = $tbase$746$i;
    HEAP32[(44668)>>2] = $tsize$745$i;
    HEAP32[(44676)>>2] = 0;
    $640 = HEAP32[11172]|0;
    HEAP32[(44252)>>2] = $640;
    HEAP32[(44248)>>2] = -1;
    $i$01$i$i = 0;
    while(1) {
     $641 = $i$01$i$i << 1;
     $642 = (44256 + ($641<<2)|0);
     $643 = ((($642)) + 12|0);
     HEAP32[$643>>2] = $642;
     $644 = ((($642)) + 8|0);
     HEAP32[$644>>2] = $642;
     $645 = (($i$01$i$i) + 1)|0;
     $exitcond$i$i = ($645|0)==(32);
     if ($exitcond$i$i) {
      break;
     } else {
      $i$01$i$i = $645;
     }
    }
    $646 = (($tsize$745$i) + -40)|0;
    $647 = ((($tbase$746$i)) + 8|0);
    $648 = $647;
    $649 = $648 & 7;
    $650 = ($649|0)==(0);
    $651 = (0 - ($648))|0;
    $652 = $651 & 7;
    $653 = $650 ? 0 : $652;
    $654 = (($tbase$746$i) + ($653)|0);
    $655 = (($646) - ($653))|0;
    HEAP32[(44240)>>2] = $654;
    HEAP32[(44228)>>2] = $655;
    $656 = $655 | 1;
    $657 = ((($654)) + 4|0);
    HEAP32[$657>>2] = $656;
    $658 = (($654) + ($655)|0);
    $659 = ((($658)) + 4|0);
    HEAP32[$659>>2] = 40;
    $660 = HEAP32[(44704)>>2]|0;
    HEAP32[(44244)>>2] = $660;
   } else {
    $sp$068$i = (44664);
    while(1) {
     $661 = HEAP32[$sp$068$i>>2]|0;
     $662 = ((($sp$068$i)) + 4|0);
     $663 = HEAP32[$662>>2]|0;
     $664 = (($661) + ($663)|0);
     $665 = ($tbase$746$i|0)==($664|0);
     if ($665) {
      $$lcssa147 = $661;$$lcssa149 = $662;$$lcssa151 = $663;$sp$068$i$lcssa = $sp$068$i;
      label = 203;
      break;
     }
     $666 = ((($sp$068$i)) + 8|0);
     $667 = HEAP32[$666>>2]|0;
     $668 = ($667|0)==(0|0);
     if ($668) {
      break;
     } else {
      $sp$068$i = $667;
     }
    }
    if ((label|0) == 203) {
     $669 = ((($sp$068$i$lcssa)) + 12|0);
     $670 = HEAP32[$669>>2]|0;
     $671 = $670 & 8;
     $672 = ($671|0)==(0);
     if ($672) {
      $673 = ($635>>>0)>=($$lcssa147>>>0);
      $674 = ($635>>>0)<($tbase$746$i>>>0);
      $or$cond48$i = $674 & $673;
      if ($or$cond48$i) {
       $675 = (($$lcssa151) + ($tsize$745$i))|0;
       HEAP32[$$lcssa149>>2] = $675;
       $676 = HEAP32[(44228)>>2]|0;
       $677 = ((($635)) + 8|0);
       $678 = $677;
       $679 = $678 & 7;
       $680 = ($679|0)==(0);
       $681 = (0 - ($678))|0;
       $682 = $681 & 7;
       $683 = $680 ? 0 : $682;
       $684 = (($635) + ($683)|0);
       $685 = (($tsize$745$i) - ($683))|0;
       $686 = (($685) + ($676))|0;
       HEAP32[(44240)>>2] = $684;
       HEAP32[(44228)>>2] = $686;
       $687 = $686 | 1;
       $688 = ((($684)) + 4|0);
       HEAP32[$688>>2] = $687;
       $689 = (($684) + ($686)|0);
       $690 = ((($689)) + 4|0);
       HEAP32[$690>>2] = 40;
       $691 = HEAP32[(44704)>>2]|0;
       HEAP32[(44244)>>2] = $691;
       break;
      }
     }
    }
    $692 = HEAP32[(44232)>>2]|0;
    $693 = ($tbase$746$i>>>0)<($692>>>0);
    if ($693) {
     HEAP32[(44232)>>2] = $tbase$746$i;
     $757 = $tbase$746$i;
    } else {
     $757 = $692;
    }
    $694 = (($tbase$746$i) + ($tsize$745$i)|0);
    $sp$167$i = (44664);
    while(1) {
     $695 = HEAP32[$sp$167$i>>2]|0;
     $696 = ($695|0)==($694|0);
     if ($696) {
      $$lcssa144 = $sp$167$i;$sp$167$i$lcssa = $sp$167$i;
      label = 211;
      break;
     }
     $697 = ((($sp$167$i)) + 8|0);
     $698 = HEAP32[$697>>2]|0;
     $699 = ($698|0)==(0|0);
     if ($699) {
      $sp$0$i$i$i = (44664);
      break;
     } else {
      $sp$167$i = $698;
     }
    }
    if ((label|0) == 211) {
     $700 = ((($sp$167$i$lcssa)) + 12|0);
     $701 = HEAP32[$700>>2]|0;
     $702 = $701 & 8;
     $703 = ($702|0)==(0);
     if ($703) {
      HEAP32[$$lcssa144>>2] = $tbase$746$i;
      $704 = ((($sp$167$i$lcssa)) + 4|0);
      $705 = HEAP32[$704>>2]|0;
      $706 = (($705) + ($tsize$745$i))|0;
      HEAP32[$704>>2] = $706;
      $707 = ((($tbase$746$i)) + 8|0);
      $708 = $707;
      $709 = $708 & 7;
      $710 = ($709|0)==(0);
      $711 = (0 - ($708))|0;
      $712 = $711 & 7;
      $713 = $710 ? 0 : $712;
      $714 = (($tbase$746$i) + ($713)|0);
      $715 = ((($694)) + 8|0);
      $716 = $715;
      $717 = $716 & 7;
      $718 = ($717|0)==(0);
      $719 = (0 - ($716))|0;
      $720 = $719 & 7;
      $721 = $718 ? 0 : $720;
      $722 = (($694) + ($721)|0);
      $723 = $722;
      $724 = $714;
      $725 = (($723) - ($724))|0;
      $726 = (($714) + ($nb$0)|0);
      $727 = (($725) - ($nb$0))|0;
      $728 = $nb$0 | 3;
      $729 = ((($714)) + 4|0);
      HEAP32[$729>>2] = $728;
      $730 = ($722|0)==($635|0);
      do {
       if ($730) {
        $731 = HEAP32[(44228)>>2]|0;
        $732 = (($731) + ($727))|0;
        HEAP32[(44228)>>2] = $732;
        HEAP32[(44240)>>2] = $726;
        $733 = $732 | 1;
        $734 = ((($726)) + 4|0);
        HEAP32[$734>>2] = $733;
       } else {
        $735 = HEAP32[(44236)>>2]|0;
        $736 = ($722|0)==($735|0);
        if ($736) {
         $737 = HEAP32[(44224)>>2]|0;
         $738 = (($737) + ($727))|0;
         HEAP32[(44224)>>2] = $738;
         HEAP32[(44236)>>2] = $726;
         $739 = $738 | 1;
         $740 = ((($726)) + 4|0);
         HEAP32[$740>>2] = $739;
         $741 = (($726) + ($738)|0);
         HEAP32[$741>>2] = $738;
         break;
        }
        $742 = ((($722)) + 4|0);
        $743 = HEAP32[$742>>2]|0;
        $744 = $743 & 3;
        $745 = ($744|0)==(1);
        if ($745) {
         $746 = $743 & -8;
         $747 = $743 >>> 3;
         $748 = ($743>>>0)<(256);
         L331: do {
          if ($748) {
           $749 = ((($722)) + 8|0);
           $750 = HEAP32[$749>>2]|0;
           $751 = ((($722)) + 12|0);
           $752 = HEAP32[$751>>2]|0;
           $753 = $747 << 1;
           $754 = (44256 + ($753<<2)|0);
           $755 = ($750|0)==($754|0);
           do {
            if (!($755)) {
             $756 = ($750>>>0)<($757>>>0);
             if ($756) {
              _abort();
              // unreachable;
             }
             $758 = ((($750)) + 12|0);
             $759 = HEAP32[$758>>2]|0;
             $760 = ($759|0)==($722|0);
             if ($760) {
              break;
             }
             _abort();
             // unreachable;
            }
           } while(0);
           $761 = ($752|0)==($750|0);
           if ($761) {
            $762 = 1 << $747;
            $763 = $762 ^ -1;
            $764 = HEAP32[11054]|0;
            $765 = $764 & $763;
            HEAP32[11054] = $765;
            break;
           }
           $766 = ($752|0)==($754|0);
           do {
            if ($766) {
             $$pre9$i$i = ((($752)) + 8|0);
             $$pre$phi10$i$iZ2D = $$pre9$i$i;
            } else {
             $767 = ($752>>>0)<($757>>>0);
             if ($767) {
              _abort();
              // unreachable;
             }
             $768 = ((($752)) + 8|0);
             $769 = HEAP32[$768>>2]|0;
             $770 = ($769|0)==($722|0);
             if ($770) {
              $$pre$phi10$i$iZ2D = $768;
              break;
             }
             _abort();
             // unreachable;
            }
           } while(0);
           $771 = ((($750)) + 12|0);
           HEAP32[$771>>2] = $752;
           HEAP32[$$pre$phi10$i$iZ2D>>2] = $750;
          } else {
           $772 = ((($722)) + 24|0);
           $773 = HEAP32[$772>>2]|0;
           $774 = ((($722)) + 12|0);
           $775 = HEAP32[$774>>2]|0;
           $776 = ($775|0)==($722|0);
           do {
            if ($776) {
             $786 = ((($722)) + 16|0);
             $787 = ((($786)) + 4|0);
             $788 = HEAP32[$787>>2]|0;
             $789 = ($788|0)==(0|0);
             if ($789) {
              $790 = HEAP32[$786>>2]|0;
              $791 = ($790|0)==(0|0);
              if ($791) {
               $R$3$i$i = 0;
               break;
              } else {
               $R$1$i$i = $790;$RP$1$i$i = $786;
              }
             } else {
              $R$1$i$i = $788;$RP$1$i$i = $787;
             }
             while(1) {
              $792 = ((($R$1$i$i)) + 20|0);
              $793 = HEAP32[$792>>2]|0;
              $794 = ($793|0)==(0|0);
              if (!($794)) {
               $R$1$i$i = $793;$RP$1$i$i = $792;
               continue;
              }
              $795 = ((($R$1$i$i)) + 16|0);
              $796 = HEAP32[$795>>2]|0;
              $797 = ($796|0)==(0|0);
              if ($797) {
               $R$1$i$i$lcssa = $R$1$i$i;$RP$1$i$i$lcssa = $RP$1$i$i;
               break;
              } else {
               $R$1$i$i = $796;$RP$1$i$i = $795;
              }
             }
             $798 = ($RP$1$i$i$lcssa>>>0)<($757>>>0);
             if ($798) {
              _abort();
              // unreachable;
             } else {
              HEAP32[$RP$1$i$i$lcssa>>2] = 0;
              $R$3$i$i = $R$1$i$i$lcssa;
              break;
             }
            } else {
             $777 = ((($722)) + 8|0);
             $778 = HEAP32[$777>>2]|0;
             $779 = ($778>>>0)<($757>>>0);
             if ($779) {
              _abort();
              // unreachable;
             }
             $780 = ((($778)) + 12|0);
             $781 = HEAP32[$780>>2]|0;
             $782 = ($781|0)==($722|0);
             if (!($782)) {
              _abort();
              // unreachable;
             }
             $783 = ((($775)) + 8|0);
             $784 = HEAP32[$783>>2]|0;
             $785 = ($784|0)==($722|0);
             if ($785) {
              HEAP32[$780>>2] = $775;
              HEAP32[$783>>2] = $778;
              $R$3$i$i = $775;
              break;
             } else {
              _abort();
              // unreachable;
             }
            }
           } while(0);
           $799 = ($773|0)==(0|0);
           if ($799) {
            break;
           }
           $800 = ((($722)) + 28|0);
           $801 = HEAP32[$800>>2]|0;
           $802 = (44520 + ($801<<2)|0);
           $803 = HEAP32[$802>>2]|0;
           $804 = ($722|0)==($803|0);
           do {
            if ($804) {
             HEAP32[$802>>2] = $R$3$i$i;
             $cond$i$i = ($R$3$i$i|0)==(0|0);
             if (!($cond$i$i)) {
              break;
             }
             $805 = 1 << $801;
             $806 = $805 ^ -1;
             $807 = HEAP32[(44220)>>2]|0;
             $808 = $807 & $806;
             HEAP32[(44220)>>2] = $808;
             break L331;
            } else {
             $809 = HEAP32[(44232)>>2]|0;
             $810 = ($773>>>0)<($809>>>0);
             if ($810) {
              _abort();
              // unreachable;
             }
             $811 = ((($773)) + 16|0);
             $812 = HEAP32[$811>>2]|0;
             $813 = ($812|0)==($722|0);
             if ($813) {
              HEAP32[$811>>2] = $R$3$i$i;
             } else {
              $814 = ((($773)) + 20|0);
              HEAP32[$814>>2] = $R$3$i$i;
             }
             $815 = ($R$3$i$i|0)==(0|0);
             if ($815) {
              break L331;
             }
            }
           } while(0);
           $816 = HEAP32[(44232)>>2]|0;
           $817 = ($R$3$i$i>>>0)<($816>>>0);
           if ($817) {
            _abort();
            // unreachable;
           }
           $818 = ((($R$3$i$i)) + 24|0);
           HEAP32[$818>>2] = $773;
           $819 = ((($722)) + 16|0);
           $820 = HEAP32[$819>>2]|0;
           $821 = ($820|0)==(0|0);
           do {
            if (!($821)) {
             $822 = ($820>>>0)<($816>>>0);
             if ($822) {
              _abort();
              // unreachable;
             } else {
              $823 = ((($R$3$i$i)) + 16|0);
              HEAP32[$823>>2] = $820;
              $824 = ((($820)) + 24|0);
              HEAP32[$824>>2] = $R$3$i$i;
              break;
             }
            }
           } while(0);
           $825 = ((($819)) + 4|0);
           $826 = HEAP32[$825>>2]|0;
           $827 = ($826|0)==(0|0);
           if ($827) {
            break;
           }
           $828 = HEAP32[(44232)>>2]|0;
           $829 = ($826>>>0)<($828>>>0);
           if ($829) {
            _abort();
            // unreachable;
           } else {
            $830 = ((($R$3$i$i)) + 20|0);
            HEAP32[$830>>2] = $826;
            $831 = ((($826)) + 24|0);
            HEAP32[$831>>2] = $R$3$i$i;
            break;
           }
          }
         } while(0);
         $832 = (($722) + ($746)|0);
         $833 = (($746) + ($727))|0;
         $oldfirst$0$i$i = $832;$qsize$0$i$i = $833;
        } else {
         $oldfirst$0$i$i = $722;$qsize$0$i$i = $727;
        }
        $834 = ((($oldfirst$0$i$i)) + 4|0);
        $835 = HEAP32[$834>>2]|0;
        $836 = $835 & -2;
        HEAP32[$834>>2] = $836;
        $837 = $qsize$0$i$i | 1;
        $838 = ((($726)) + 4|0);
        HEAP32[$838>>2] = $837;
        $839 = (($726) + ($qsize$0$i$i)|0);
        HEAP32[$839>>2] = $qsize$0$i$i;
        $840 = $qsize$0$i$i >>> 3;
        $841 = ($qsize$0$i$i>>>0)<(256);
        if ($841) {
         $842 = $840 << 1;
         $843 = (44256 + ($842<<2)|0);
         $844 = HEAP32[11054]|0;
         $845 = 1 << $840;
         $846 = $844 & $845;
         $847 = ($846|0)==(0);
         do {
          if ($847) {
           $848 = $844 | $845;
           HEAP32[11054] = $848;
           $$pre$i16$i = ((($843)) + 8|0);
           $$pre$phi$i17$iZ2D = $$pre$i16$i;$F4$0$i$i = $843;
          } else {
           $849 = ((($843)) + 8|0);
           $850 = HEAP32[$849>>2]|0;
           $851 = HEAP32[(44232)>>2]|0;
           $852 = ($850>>>0)<($851>>>0);
           if (!($852)) {
            $$pre$phi$i17$iZ2D = $849;$F4$0$i$i = $850;
            break;
           }
           _abort();
           // unreachable;
          }
         } while(0);
         HEAP32[$$pre$phi$i17$iZ2D>>2] = $726;
         $853 = ((($F4$0$i$i)) + 12|0);
         HEAP32[$853>>2] = $726;
         $854 = ((($726)) + 8|0);
         HEAP32[$854>>2] = $F4$0$i$i;
         $855 = ((($726)) + 12|0);
         HEAP32[$855>>2] = $843;
         break;
        }
        $856 = $qsize$0$i$i >>> 8;
        $857 = ($856|0)==(0);
        do {
         if ($857) {
          $I7$0$i$i = 0;
         } else {
          $858 = ($qsize$0$i$i>>>0)>(16777215);
          if ($858) {
           $I7$0$i$i = 31;
           break;
          }
          $859 = (($856) + 1048320)|0;
          $860 = $859 >>> 16;
          $861 = $860 & 8;
          $862 = $856 << $861;
          $863 = (($862) + 520192)|0;
          $864 = $863 >>> 16;
          $865 = $864 & 4;
          $866 = $865 | $861;
          $867 = $862 << $865;
          $868 = (($867) + 245760)|0;
          $869 = $868 >>> 16;
          $870 = $869 & 2;
          $871 = $866 | $870;
          $872 = (14 - ($871))|0;
          $873 = $867 << $870;
          $874 = $873 >>> 15;
          $875 = (($872) + ($874))|0;
          $876 = $875 << 1;
          $877 = (($875) + 7)|0;
          $878 = $qsize$0$i$i >>> $877;
          $879 = $878 & 1;
          $880 = $879 | $876;
          $I7$0$i$i = $880;
         }
        } while(0);
        $881 = (44520 + ($I7$0$i$i<<2)|0);
        $882 = ((($726)) + 28|0);
        HEAP32[$882>>2] = $I7$0$i$i;
        $883 = ((($726)) + 16|0);
        $884 = ((($883)) + 4|0);
        HEAP32[$884>>2] = 0;
        HEAP32[$883>>2] = 0;
        $885 = HEAP32[(44220)>>2]|0;
        $886 = 1 << $I7$0$i$i;
        $887 = $885 & $886;
        $888 = ($887|0)==(0);
        if ($888) {
         $889 = $885 | $886;
         HEAP32[(44220)>>2] = $889;
         HEAP32[$881>>2] = $726;
         $890 = ((($726)) + 24|0);
         HEAP32[$890>>2] = $881;
         $891 = ((($726)) + 12|0);
         HEAP32[$891>>2] = $726;
         $892 = ((($726)) + 8|0);
         HEAP32[$892>>2] = $726;
         break;
        }
        $893 = HEAP32[$881>>2]|0;
        $894 = ($I7$0$i$i|0)==(31);
        $895 = $I7$0$i$i >>> 1;
        $896 = (25 - ($895))|0;
        $897 = $894 ? 0 : $896;
        $898 = $qsize$0$i$i << $897;
        $K8$0$i$i = $898;$T$0$i18$i = $893;
        while(1) {
         $899 = ((($T$0$i18$i)) + 4|0);
         $900 = HEAP32[$899>>2]|0;
         $901 = $900 & -8;
         $902 = ($901|0)==($qsize$0$i$i|0);
         if ($902) {
          $T$0$i18$i$lcssa = $T$0$i18$i;
          label = 281;
          break;
         }
         $903 = $K8$0$i$i >>> 31;
         $904 = (((($T$0$i18$i)) + 16|0) + ($903<<2)|0);
         $905 = $K8$0$i$i << 1;
         $906 = HEAP32[$904>>2]|0;
         $907 = ($906|0)==(0|0);
         if ($907) {
          $$lcssa = $904;$T$0$i18$i$lcssa139 = $T$0$i18$i;
          label = 278;
          break;
         } else {
          $K8$0$i$i = $905;$T$0$i18$i = $906;
         }
        }
        if ((label|0) == 278) {
         $908 = HEAP32[(44232)>>2]|0;
         $909 = ($$lcssa>>>0)<($908>>>0);
         if ($909) {
          _abort();
          // unreachable;
         } else {
          HEAP32[$$lcssa>>2] = $726;
          $910 = ((($726)) + 24|0);
          HEAP32[$910>>2] = $T$0$i18$i$lcssa139;
          $911 = ((($726)) + 12|0);
          HEAP32[$911>>2] = $726;
          $912 = ((($726)) + 8|0);
          HEAP32[$912>>2] = $726;
          break;
         }
        }
        else if ((label|0) == 281) {
         $913 = ((($T$0$i18$i$lcssa)) + 8|0);
         $914 = HEAP32[$913>>2]|0;
         $915 = HEAP32[(44232)>>2]|0;
         $916 = ($914>>>0)>=($915>>>0);
         $not$$i20$i = ($T$0$i18$i$lcssa>>>0)>=($915>>>0);
         $917 = $916 & $not$$i20$i;
         if ($917) {
          $918 = ((($914)) + 12|0);
          HEAP32[$918>>2] = $726;
          HEAP32[$913>>2] = $726;
          $919 = ((($726)) + 8|0);
          HEAP32[$919>>2] = $914;
          $920 = ((($726)) + 12|0);
          HEAP32[$920>>2] = $T$0$i18$i$lcssa;
          $921 = ((($726)) + 24|0);
          HEAP32[$921>>2] = 0;
          break;
         } else {
          _abort();
          // unreachable;
         }
        }
       }
      } while(0);
      $1052 = ((($714)) + 8|0);
      $$0 = $1052;
      return ($$0|0);
     } else {
      $sp$0$i$i$i = (44664);
     }
    }
    while(1) {
     $922 = HEAP32[$sp$0$i$i$i>>2]|0;
     $923 = ($922>>>0)>($635>>>0);
     if (!($923)) {
      $924 = ((($sp$0$i$i$i)) + 4|0);
      $925 = HEAP32[$924>>2]|0;
      $926 = (($922) + ($925)|0);
      $927 = ($926>>>0)>($635>>>0);
      if ($927) {
       $$lcssa142 = $926;
       break;
      }
     }
     $928 = ((($sp$0$i$i$i)) + 8|0);
     $929 = HEAP32[$928>>2]|0;
     $sp$0$i$i$i = $929;
    }
    $930 = ((($$lcssa142)) + -47|0);
    $931 = ((($930)) + 8|0);
    $932 = $931;
    $933 = $932 & 7;
    $934 = ($933|0)==(0);
    $935 = (0 - ($932))|0;
    $936 = $935 & 7;
    $937 = $934 ? 0 : $936;
    $938 = (($930) + ($937)|0);
    $939 = ((($635)) + 16|0);
    $940 = ($938>>>0)<($939>>>0);
    $941 = $940 ? $635 : $938;
    $942 = ((($941)) + 8|0);
    $943 = ((($941)) + 24|0);
    $944 = (($tsize$745$i) + -40)|0;
    $945 = ((($tbase$746$i)) + 8|0);
    $946 = $945;
    $947 = $946 & 7;
    $948 = ($947|0)==(0);
    $949 = (0 - ($946))|0;
    $950 = $949 & 7;
    $951 = $948 ? 0 : $950;
    $952 = (($tbase$746$i) + ($951)|0);
    $953 = (($944) - ($951))|0;
    HEAP32[(44240)>>2] = $952;
    HEAP32[(44228)>>2] = $953;
    $954 = $953 | 1;
    $955 = ((($952)) + 4|0);
    HEAP32[$955>>2] = $954;
    $956 = (($952) + ($953)|0);
    $957 = ((($956)) + 4|0);
    HEAP32[$957>>2] = 40;
    $958 = HEAP32[(44704)>>2]|0;
    HEAP32[(44244)>>2] = $958;
    $959 = ((($941)) + 4|0);
    HEAP32[$959>>2] = 27;
    ;HEAP32[$942>>2]=HEAP32[(44664)>>2]|0;HEAP32[$942+4>>2]=HEAP32[(44664)+4>>2]|0;HEAP32[$942+8>>2]=HEAP32[(44664)+8>>2]|0;HEAP32[$942+12>>2]=HEAP32[(44664)+12>>2]|0;
    HEAP32[(44664)>>2] = $tbase$746$i;
    HEAP32[(44668)>>2] = $tsize$745$i;
    HEAP32[(44676)>>2] = 0;
    HEAP32[(44672)>>2] = $942;
    $p$0$i$i = $943;
    while(1) {
     $960 = ((($p$0$i$i)) + 4|0);
     HEAP32[$960>>2] = 7;
     $961 = ((($960)) + 4|0);
     $962 = ($961>>>0)<($$lcssa142>>>0);
     if ($962) {
      $p$0$i$i = $960;
     } else {
      break;
     }
    }
    $963 = ($941|0)==($635|0);
    if (!($963)) {
     $964 = $941;
     $965 = $635;
     $966 = (($964) - ($965))|0;
     $967 = HEAP32[$959>>2]|0;
     $968 = $967 & -2;
     HEAP32[$959>>2] = $968;
     $969 = $966 | 1;
     $970 = ((($635)) + 4|0);
     HEAP32[$970>>2] = $969;
     HEAP32[$941>>2] = $966;
     $971 = $966 >>> 3;
     $972 = ($966>>>0)<(256);
     if ($972) {
      $973 = $971 << 1;
      $974 = (44256 + ($973<<2)|0);
      $975 = HEAP32[11054]|0;
      $976 = 1 << $971;
      $977 = $975 & $976;
      $978 = ($977|0)==(0);
      if ($978) {
       $979 = $975 | $976;
       HEAP32[11054] = $979;
       $$pre$i$i = ((($974)) + 8|0);
       $$pre$phi$i$iZ2D = $$pre$i$i;$F$0$i$i = $974;
      } else {
       $980 = ((($974)) + 8|0);
       $981 = HEAP32[$980>>2]|0;
       $982 = HEAP32[(44232)>>2]|0;
       $983 = ($981>>>0)<($982>>>0);
       if ($983) {
        _abort();
        // unreachable;
       } else {
        $$pre$phi$i$iZ2D = $980;$F$0$i$i = $981;
       }
      }
      HEAP32[$$pre$phi$i$iZ2D>>2] = $635;
      $984 = ((($F$0$i$i)) + 12|0);
      HEAP32[$984>>2] = $635;
      $985 = ((($635)) + 8|0);
      HEAP32[$985>>2] = $F$0$i$i;
      $986 = ((($635)) + 12|0);
      HEAP32[$986>>2] = $974;
      break;
     }
     $987 = $966 >>> 8;
     $988 = ($987|0)==(0);
     if ($988) {
      $I1$0$i$i = 0;
     } else {
      $989 = ($966>>>0)>(16777215);
      if ($989) {
       $I1$0$i$i = 31;
      } else {
       $990 = (($987) + 1048320)|0;
       $991 = $990 >>> 16;
       $992 = $991 & 8;
       $993 = $987 << $992;
       $994 = (($993) + 520192)|0;
       $995 = $994 >>> 16;
       $996 = $995 & 4;
       $997 = $996 | $992;
       $998 = $993 << $996;
       $999 = (($998) + 245760)|0;
       $1000 = $999 >>> 16;
       $1001 = $1000 & 2;
       $1002 = $997 | $1001;
       $1003 = (14 - ($1002))|0;
       $1004 = $998 << $1001;
       $1005 = $1004 >>> 15;
       $1006 = (($1003) + ($1005))|0;
       $1007 = $1006 << 1;
       $1008 = (($1006) + 7)|0;
       $1009 = $966 >>> $1008;
       $1010 = $1009 & 1;
       $1011 = $1010 | $1007;
       $I1$0$i$i = $1011;
      }
     }
     $1012 = (44520 + ($I1$0$i$i<<2)|0);
     $1013 = ((($635)) + 28|0);
     HEAP32[$1013>>2] = $I1$0$i$i;
     $1014 = ((($635)) + 20|0);
     HEAP32[$1014>>2] = 0;
     HEAP32[$939>>2] = 0;
     $1015 = HEAP32[(44220)>>2]|0;
     $1016 = 1 << $I1$0$i$i;
     $1017 = $1015 & $1016;
     $1018 = ($1017|0)==(0);
     if ($1018) {
      $1019 = $1015 | $1016;
      HEAP32[(44220)>>2] = $1019;
      HEAP32[$1012>>2] = $635;
      $1020 = ((($635)) + 24|0);
      HEAP32[$1020>>2] = $1012;
      $1021 = ((($635)) + 12|0);
      HEAP32[$1021>>2] = $635;
      $1022 = ((($635)) + 8|0);
      HEAP32[$1022>>2] = $635;
      break;
     }
     $1023 = HEAP32[$1012>>2]|0;
     $1024 = ($I1$0$i$i|0)==(31);
     $1025 = $I1$0$i$i >>> 1;
     $1026 = (25 - ($1025))|0;
     $1027 = $1024 ? 0 : $1026;
     $1028 = $966 << $1027;
     $K2$0$i$i = $1028;$T$0$i$i = $1023;
     while(1) {
      $1029 = ((($T$0$i$i)) + 4|0);
      $1030 = HEAP32[$1029>>2]|0;
      $1031 = $1030 & -8;
      $1032 = ($1031|0)==($966|0);
      if ($1032) {
       $T$0$i$i$lcssa = $T$0$i$i;
       label = 307;
       break;
      }
      $1033 = $K2$0$i$i >>> 31;
      $1034 = (((($T$0$i$i)) + 16|0) + ($1033<<2)|0);
      $1035 = $K2$0$i$i << 1;
      $1036 = HEAP32[$1034>>2]|0;
      $1037 = ($1036|0)==(0|0);
      if ($1037) {
       $$lcssa141 = $1034;$T$0$i$i$lcssa140 = $T$0$i$i;
       label = 304;
       break;
      } else {
       $K2$0$i$i = $1035;$T$0$i$i = $1036;
      }
     }
     if ((label|0) == 304) {
      $1038 = HEAP32[(44232)>>2]|0;
      $1039 = ($$lcssa141>>>0)<($1038>>>0);
      if ($1039) {
       _abort();
       // unreachable;
      } else {
       HEAP32[$$lcssa141>>2] = $635;
       $1040 = ((($635)) + 24|0);
       HEAP32[$1040>>2] = $T$0$i$i$lcssa140;
       $1041 = ((($635)) + 12|0);
       HEAP32[$1041>>2] = $635;
       $1042 = ((($635)) + 8|0);
       HEAP32[$1042>>2] = $635;
       break;
      }
     }
     else if ((label|0) == 307) {
      $1043 = ((($T$0$i$i$lcssa)) + 8|0);
      $1044 = HEAP32[$1043>>2]|0;
      $1045 = HEAP32[(44232)>>2]|0;
      $1046 = ($1044>>>0)>=($1045>>>0);
      $not$$i$i = ($T$0$i$i$lcssa>>>0)>=($1045>>>0);
      $1047 = $1046 & $not$$i$i;
      if ($1047) {
       $1048 = ((($1044)) + 12|0);
       HEAP32[$1048>>2] = $635;
       HEAP32[$1043>>2] = $635;
       $1049 = ((($635)) + 8|0);
       HEAP32[$1049>>2] = $1044;
       $1050 = ((($635)) + 12|0);
       HEAP32[$1050>>2] = $T$0$i$i$lcssa;
       $1051 = ((($635)) + 24|0);
       HEAP32[$1051>>2] = 0;
       break;
      } else {
       _abort();
       // unreachable;
      }
     }
    }
   }
  } while(0);
  $1053 = HEAP32[(44228)>>2]|0;
  $1054 = ($1053>>>0)>($nb$0>>>0);
  if ($1054) {
   $1055 = (($1053) - ($nb$0))|0;
   HEAP32[(44228)>>2] = $1055;
   $1056 = HEAP32[(44240)>>2]|0;
   $1057 = (($1056) + ($nb$0)|0);
   HEAP32[(44240)>>2] = $1057;
   $1058 = $1055 | 1;
   $1059 = ((($1057)) + 4|0);
   HEAP32[$1059>>2] = $1058;
   $1060 = $nb$0 | 3;
   $1061 = ((($1056)) + 4|0);
   HEAP32[$1061>>2] = $1060;
   $1062 = ((($1056)) + 8|0);
   $$0 = $1062;
   return ($$0|0);
  }
 }
 $1063 = (___errno_location()|0);
 HEAP32[$1063>>2] = 12;
 $$0 = 0;
 return ($$0|0);
}
function _free($mem) {
 $mem = $mem|0;
 var $$lcssa = 0, $$pre = 0, $$pre$phi41Z2D = 0, $$pre$phi43Z2D = 0, $$pre$phiZ2D = 0, $$pre40 = 0, $$pre42 = 0, $0 = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0;
 var $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0;
 var $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0;
 var $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0;
 var $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0, $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0;
 var $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0;
 var $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0;
 var $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0;
 var $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0;
 var $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0;
 var $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0, $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0;
 var $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0, $297 = 0, $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0;
 var $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0, $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0;
 var $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0;
 var $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0;
 var $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0;
 var $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $F18$0 = 0, $I20$0 = 0, $K21$0 = 0, $R$1 = 0, $R$1$lcssa = 0, $R$3 = 0, $R8$1 = 0, $R8$1$lcssa = 0, $R8$3 = 0, $RP$1 = 0, $RP$1$lcssa = 0, $RP10$1 = 0, $RP10$1$lcssa = 0;
 var $T$0 = 0, $T$0$lcssa = 0, $T$0$lcssa48 = 0, $cond20 = 0, $cond21 = 0, $not$ = 0, $p$1 = 0, $psize$1 = 0, $psize$2 = 0, $sp$0$i = 0, $sp$0$in$i = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ($mem|0)==(0|0);
 if ($0) {
  return;
 }
 $1 = ((($mem)) + -8|0);
 $2 = HEAP32[(44232)>>2]|0;
 $3 = ($1>>>0)<($2>>>0);
 if ($3) {
  _abort();
  // unreachable;
 }
 $4 = ((($mem)) + -4|0);
 $5 = HEAP32[$4>>2]|0;
 $6 = $5 & 3;
 $7 = ($6|0)==(1);
 if ($7) {
  _abort();
  // unreachable;
 }
 $8 = $5 & -8;
 $9 = (($1) + ($8)|0);
 $10 = $5 & 1;
 $11 = ($10|0)==(0);
 do {
  if ($11) {
   $12 = HEAP32[$1>>2]|0;
   $13 = ($6|0)==(0);
   if ($13) {
    return;
   }
   $14 = (0 - ($12))|0;
   $15 = (($1) + ($14)|0);
   $16 = (($12) + ($8))|0;
   $17 = ($15>>>0)<($2>>>0);
   if ($17) {
    _abort();
    // unreachable;
   }
   $18 = HEAP32[(44236)>>2]|0;
   $19 = ($15|0)==($18|0);
   if ($19) {
    $104 = ((($9)) + 4|0);
    $105 = HEAP32[$104>>2]|0;
    $106 = $105 & 3;
    $107 = ($106|0)==(3);
    if (!($107)) {
     $p$1 = $15;$psize$1 = $16;
     break;
    }
    HEAP32[(44224)>>2] = $16;
    $108 = $105 & -2;
    HEAP32[$104>>2] = $108;
    $109 = $16 | 1;
    $110 = ((($15)) + 4|0);
    HEAP32[$110>>2] = $109;
    $111 = (($15) + ($16)|0);
    HEAP32[$111>>2] = $16;
    return;
   }
   $20 = $12 >>> 3;
   $21 = ($12>>>0)<(256);
   if ($21) {
    $22 = ((($15)) + 8|0);
    $23 = HEAP32[$22>>2]|0;
    $24 = ((($15)) + 12|0);
    $25 = HEAP32[$24>>2]|0;
    $26 = $20 << 1;
    $27 = (44256 + ($26<<2)|0);
    $28 = ($23|0)==($27|0);
    if (!($28)) {
     $29 = ($23>>>0)<($2>>>0);
     if ($29) {
      _abort();
      // unreachable;
     }
     $30 = ((($23)) + 12|0);
     $31 = HEAP32[$30>>2]|0;
     $32 = ($31|0)==($15|0);
     if (!($32)) {
      _abort();
      // unreachable;
     }
    }
    $33 = ($25|0)==($23|0);
    if ($33) {
     $34 = 1 << $20;
     $35 = $34 ^ -1;
     $36 = HEAP32[11054]|0;
     $37 = $36 & $35;
     HEAP32[11054] = $37;
     $p$1 = $15;$psize$1 = $16;
     break;
    }
    $38 = ($25|0)==($27|0);
    if ($38) {
     $$pre42 = ((($25)) + 8|0);
     $$pre$phi43Z2D = $$pre42;
    } else {
     $39 = ($25>>>0)<($2>>>0);
     if ($39) {
      _abort();
      // unreachable;
     }
     $40 = ((($25)) + 8|0);
     $41 = HEAP32[$40>>2]|0;
     $42 = ($41|0)==($15|0);
     if ($42) {
      $$pre$phi43Z2D = $40;
     } else {
      _abort();
      // unreachable;
     }
    }
    $43 = ((($23)) + 12|0);
    HEAP32[$43>>2] = $25;
    HEAP32[$$pre$phi43Z2D>>2] = $23;
    $p$1 = $15;$psize$1 = $16;
    break;
   }
   $44 = ((($15)) + 24|0);
   $45 = HEAP32[$44>>2]|0;
   $46 = ((($15)) + 12|0);
   $47 = HEAP32[$46>>2]|0;
   $48 = ($47|0)==($15|0);
   do {
    if ($48) {
     $58 = ((($15)) + 16|0);
     $59 = ((($58)) + 4|0);
     $60 = HEAP32[$59>>2]|0;
     $61 = ($60|0)==(0|0);
     if ($61) {
      $62 = HEAP32[$58>>2]|0;
      $63 = ($62|0)==(0|0);
      if ($63) {
       $R$3 = 0;
       break;
      } else {
       $R$1 = $62;$RP$1 = $58;
      }
     } else {
      $R$1 = $60;$RP$1 = $59;
     }
     while(1) {
      $64 = ((($R$1)) + 20|0);
      $65 = HEAP32[$64>>2]|0;
      $66 = ($65|0)==(0|0);
      if (!($66)) {
       $R$1 = $65;$RP$1 = $64;
       continue;
      }
      $67 = ((($R$1)) + 16|0);
      $68 = HEAP32[$67>>2]|0;
      $69 = ($68|0)==(0|0);
      if ($69) {
       $R$1$lcssa = $R$1;$RP$1$lcssa = $RP$1;
       break;
      } else {
       $R$1 = $68;$RP$1 = $67;
      }
     }
     $70 = ($RP$1$lcssa>>>0)<($2>>>0);
     if ($70) {
      _abort();
      // unreachable;
     } else {
      HEAP32[$RP$1$lcssa>>2] = 0;
      $R$3 = $R$1$lcssa;
      break;
     }
    } else {
     $49 = ((($15)) + 8|0);
     $50 = HEAP32[$49>>2]|0;
     $51 = ($50>>>0)<($2>>>0);
     if ($51) {
      _abort();
      // unreachable;
     }
     $52 = ((($50)) + 12|0);
     $53 = HEAP32[$52>>2]|0;
     $54 = ($53|0)==($15|0);
     if (!($54)) {
      _abort();
      // unreachable;
     }
     $55 = ((($47)) + 8|0);
     $56 = HEAP32[$55>>2]|0;
     $57 = ($56|0)==($15|0);
     if ($57) {
      HEAP32[$52>>2] = $47;
      HEAP32[$55>>2] = $50;
      $R$3 = $47;
      break;
     } else {
      _abort();
      // unreachable;
     }
    }
   } while(0);
   $71 = ($45|0)==(0|0);
   if ($71) {
    $p$1 = $15;$psize$1 = $16;
   } else {
    $72 = ((($15)) + 28|0);
    $73 = HEAP32[$72>>2]|0;
    $74 = (44520 + ($73<<2)|0);
    $75 = HEAP32[$74>>2]|0;
    $76 = ($15|0)==($75|0);
    if ($76) {
     HEAP32[$74>>2] = $R$3;
     $cond20 = ($R$3|0)==(0|0);
     if ($cond20) {
      $77 = 1 << $73;
      $78 = $77 ^ -1;
      $79 = HEAP32[(44220)>>2]|0;
      $80 = $79 & $78;
      HEAP32[(44220)>>2] = $80;
      $p$1 = $15;$psize$1 = $16;
      break;
     }
    } else {
     $81 = HEAP32[(44232)>>2]|0;
     $82 = ($45>>>0)<($81>>>0);
     if ($82) {
      _abort();
      // unreachable;
     }
     $83 = ((($45)) + 16|0);
     $84 = HEAP32[$83>>2]|0;
     $85 = ($84|0)==($15|0);
     if ($85) {
      HEAP32[$83>>2] = $R$3;
     } else {
      $86 = ((($45)) + 20|0);
      HEAP32[$86>>2] = $R$3;
     }
     $87 = ($R$3|0)==(0|0);
     if ($87) {
      $p$1 = $15;$psize$1 = $16;
      break;
     }
    }
    $88 = HEAP32[(44232)>>2]|0;
    $89 = ($R$3>>>0)<($88>>>0);
    if ($89) {
     _abort();
     // unreachable;
    }
    $90 = ((($R$3)) + 24|0);
    HEAP32[$90>>2] = $45;
    $91 = ((($15)) + 16|0);
    $92 = HEAP32[$91>>2]|0;
    $93 = ($92|0)==(0|0);
    do {
     if (!($93)) {
      $94 = ($92>>>0)<($88>>>0);
      if ($94) {
       _abort();
       // unreachable;
      } else {
       $95 = ((($R$3)) + 16|0);
       HEAP32[$95>>2] = $92;
       $96 = ((($92)) + 24|0);
       HEAP32[$96>>2] = $R$3;
       break;
      }
     }
    } while(0);
    $97 = ((($91)) + 4|0);
    $98 = HEAP32[$97>>2]|0;
    $99 = ($98|0)==(0|0);
    if ($99) {
     $p$1 = $15;$psize$1 = $16;
    } else {
     $100 = HEAP32[(44232)>>2]|0;
     $101 = ($98>>>0)<($100>>>0);
     if ($101) {
      _abort();
      // unreachable;
     } else {
      $102 = ((($R$3)) + 20|0);
      HEAP32[$102>>2] = $98;
      $103 = ((($98)) + 24|0);
      HEAP32[$103>>2] = $R$3;
      $p$1 = $15;$psize$1 = $16;
      break;
     }
    }
   }
  } else {
   $p$1 = $1;$psize$1 = $8;
  }
 } while(0);
 $112 = ($p$1>>>0)<($9>>>0);
 if (!($112)) {
  _abort();
  // unreachable;
 }
 $113 = ((($9)) + 4|0);
 $114 = HEAP32[$113>>2]|0;
 $115 = $114 & 1;
 $116 = ($115|0)==(0);
 if ($116) {
  _abort();
  // unreachable;
 }
 $117 = $114 & 2;
 $118 = ($117|0)==(0);
 if ($118) {
  $119 = HEAP32[(44240)>>2]|0;
  $120 = ($9|0)==($119|0);
  if ($120) {
   $121 = HEAP32[(44228)>>2]|0;
   $122 = (($121) + ($psize$1))|0;
   HEAP32[(44228)>>2] = $122;
   HEAP32[(44240)>>2] = $p$1;
   $123 = $122 | 1;
   $124 = ((($p$1)) + 4|0);
   HEAP32[$124>>2] = $123;
   $125 = HEAP32[(44236)>>2]|0;
   $126 = ($p$1|0)==($125|0);
   if (!($126)) {
    return;
   }
   HEAP32[(44236)>>2] = 0;
   HEAP32[(44224)>>2] = 0;
   return;
  }
  $127 = HEAP32[(44236)>>2]|0;
  $128 = ($9|0)==($127|0);
  if ($128) {
   $129 = HEAP32[(44224)>>2]|0;
   $130 = (($129) + ($psize$1))|0;
   HEAP32[(44224)>>2] = $130;
   HEAP32[(44236)>>2] = $p$1;
   $131 = $130 | 1;
   $132 = ((($p$1)) + 4|0);
   HEAP32[$132>>2] = $131;
   $133 = (($p$1) + ($130)|0);
   HEAP32[$133>>2] = $130;
   return;
  }
  $134 = $114 & -8;
  $135 = (($134) + ($psize$1))|0;
  $136 = $114 >>> 3;
  $137 = ($114>>>0)<(256);
  do {
   if ($137) {
    $138 = ((($9)) + 8|0);
    $139 = HEAP32[$138>>2]|0;
    $140 = ((($9)) + 12|0);
    $141 = HEAP32[$140>>2]|0;
    $142 = $136 << 1;
    $143 = (44256 + ($142<<2)|0);
    $144 = ($139|0)==($143|0);
    if (!($144)) {
     $145 = HEAP32[(44232)>>2]|0;
     $146 = ($139>>>0)<($145>>>0);
     if ($146) {
      _abort();
      // unreachable;
     }
     $147 = ((($139)) + 12|0);
     $148 = HEAP32[$147>>2]|0;
     $149 = ($148|0)==($9|0);
     if (!($149)) {
      _abort();
      // unreachable;
     }
    }
    $150 = ($141|0)==($139|0);
    if ($150) {
     $151 = 1 << $136;
     $152 = $151 ^ -1;
     $153 = HEAP32[11054]|0;
     $154 = $153 & $152;
     HEAP32[11054] = $154;
     break;
    }
    $155 = ($141|0)==($143|0);
    if ($155) {
     $$pre40 = ((($141)) + 8|0);
     $$pre$phi41Z2D = $$pre40;
    } else {
     $156 = HEAP32[(44232)>>2]|0;
     $157 = ($141>>>0)<($156>>>0);
     if ($157) {
      _abort();
      // unreachable;
     }
     $158 = ((($141)) + 8|0);
     $159 = HEAP32[$158>>2]|0;
     $160 = ($159|0)==($9|0);
     if ($160) {
      $$pre$phi41Z2D = $158;
     } else {
      _abort();
      // unreachable;
     }
    }
    $161 = ((($139)) + 12|0);
    HEAP32[$161>>2] = $141;
    HEAP32[$$pre$phi41Z2D>>2] = $139;
   } else {
    $162 = ((($9)) + 24|0);
    $163 = HEAP32[$162>>2]|0;
    $164 = ((($9)) + 12|0);
    $165 = HEAP32[$164>>2]|0;
    $166 = ($165|0)==($9|0);
    do {
     if ($166) {
      $177 = ((($9)) + 16|0);
      $178 = ((($177)) + 4|0);
      $179 = HEAP32[$178>>2]|0;
      $180 = ($179|0)==(0|0);
      if ($180) {
       $181 = HEAP32[$177>>2]|0;
       $182 = ($181|0)==(0|0);
       if ($182) {
        $R8$3 = 0;
        break;
       } else {
        $R8$1 = $181;$RP10$1 = $177;
       }
      } else {
       $R8$1 = $179;$RP10$1 = $178;
      }
      while(1) {
       $183 = ((($R8$1)) + 20|0);
       $184 = HEAP32[$183>>2]|0;
       $185 = ($184|0)==(0|0);
       if (!($185)) {
        $R8$1 = $184;$RP10$1 = $183;
        continue;
       }
       $186 = ((($R8$1)) + 16|0);
       $187 = HEAP32[$186>>2]|0;
       $188 = ($187|0)==(0|0);
       if ($188) {
        $R8$1$lcssa = $R8$1;$RP10$1$lcssa = $RP10$1;
        break;
       } else {
        $R8$1 = $187;$RP10$1 = $186;
       }
      }
      $189 = HEAP32[(44232)>>2]|0;
      $190 = ($RP10$1$lcssa>>>0)<($189>>>0);
      if ($190) {
       _abort();
       // unreachable;
      } else {
       HEAP32[$RP10$1$lcssa>>2] = 0;
       $R8$3 = $R8$1$lcssa;
       break;
      }
     } else {
      $167 = ((($9)) + 8|0);
      $168 = HEAP32[$167>>2]|0;
      $169 = HEAP32[(44232)>>2]|0;
      $170 = ($168>>>0)<($169>>>0);
      if ($170) {
       _abort();
       // unreachable;
      }
      $171 = ((($168)) + 12|0);
      $172 = HEAP32[$171>>2]|0;
      $173 = ($172|0)==($9|0);
      if (!($173)) {
       _abort();
       // unreachable;
      }
      $174 = ((($165)) + 8|0);
      $175 = HEAP32[$174>>2]|0;
      $176 = ($175|0)==($9|0);
      if ($176) {
       HEAP32[$171>>2] = $165;
       HEAP32[$174>>2] = $168;
       $R8$3 = $165;
       break;
      } else {
       _abort();
       // unreachable;
      }
     }
    } while(0);
    $191 = ($163|0)==(0|0);
    if (!($191)) {
     $192 = ((($9)) + 28|0);
     $193 = HEAP32[$192>>2]|0;
     $194 = (44520 + ($193<<2)|0);
     $195 = HEAP32[$194>>2]|0;
     $196 = ($9|0)==($195|0);
     if ($196) {
      HEAP32[$194>>2] = $R8$3;
      $cond21 = ($R8$3|0)==(0|0);
      if ($cond21) {
       $197 = 1 << $193;
       $198 = $197 ^ -1;
       $199 = HEAP32[(44220)>>2]|0;
       $200 = $199 & $198;
       HEAP32[(44220)>>2] = $200;
       break;
      }
     } else {
      $201 = HEAP32[(44232)>>2]|0;
      $202 = ($163>>>0)<($201>>>0);
      if ($202) {
       _abort();
       // unreachable;
      }
      $203 = ((($163)) + 16|0);
      $204 = HEAP32[$203>>2]|0;
      $205 = ($204|0)==($9|0);
      if ($205) {
       HEAP32[$203>>2] = $R8$3;
      } else {
       $206 = ((($163)) + 20|0);
       HEAP32[$206>>2] = $R8$3;
      }
      $207 = ($R8$3|0)==(0|0);
      if ($207) {
       break;
      }
     }
     $208 = HEAP32[(44232)>>2]|0;
     $209 = ($R8$3>>>0)<($208>>>0);
     if ($209) {
      _abort();
      // unreachable;
     }
     $210 = ((($R8$3)) + 24|0);
     HEAP32[$210>>2] = $163;
     $211 = ((($9)) + 16|0);
     $212 = HEAP32[$211>>2]|0;
     $213 = ($212|0)==(0|0);
     do {
      if (!($213)) {
       $214 = ($212>>>0)<($208>>>0);
       if ($214) {
        _abort();
        // unreachable;
       } else {
        $215 = ((($R8$3)) + 16|0);
        HEAP32[$215>>2] = $212;
        $216 = ((($212)) + 24|0);
        HEAP32[$216>>2] = $R8$3;
        break;
       }
      }
     } while(0);
     $217 = ((($211)) + 4|0);
     $218 = HEAP32[$217>>2]|0;
     $219 = ($218|0)==(0|0);
     if (!($219)) {
      $220 = HEAP32[(44232)>>2]|0;
      $221 = ($218>>>0)<($220>>>0);
      if ($221) {
       _abort();
       // unreachable;
      } else {
       $222 = ((($R8$3)) + 20|0);
       HEAP32[$222>>2] = $218;
       $223 = ((($218)) + 24|0);
       HEAP32[$223>>2] = $R8$3;
       break;
      }
     }
    }
   }
  } while(0);
  $224 = $135 | 1;
  $225 = ((($p$1)) + 4|0);
  HEAP32[$225>>2] = $224;
  $226 = (($p$1) + ($135)|0);
  HEAP32[$226>>2] = $135;
  $227 = HEAP32[(44236)>>2]|0;
  $228 = ($p$1|0)==($227|0);
  if ($228) {
   HEAP32[(44224)>>2] = $135;
   return;
  } else {
   $psize$2 = $135;
  }
 } else {
  $229 = $114 & -2;
  HEAP32[$113>>2] = $229;
  $230 = $psize$1 | 1;
  $231 = ((($p$1)) + 4|0);
  HEAP32[$231>>2] = $230;
  $232 = (($p$1) + ($psize$1)|0);
  HEAP32[$232>>2] = $psize$1;
  $psize$2 = $psize$1;
 }
 $233 = $psize$2 >>> 3;
 $234 = ($psize$2>>>0)<(256);
 if ($234) {
  $235 = $233 << 1;
  $236 = (44256 + ($235<<2)|0);
  $237 = HEAP32[11054]|0;
  $238 = 1 << $233;
  $239 = $237 & $238;
  $240 = ($239|0)==(0);
  if ($240) {
   $241 = $237 | $238;
   HEAP32[11054] = $241;
   $$pre = ((($236)) + 8|0);
   $$pre$phiZ2D = $$pre;$F18$0 = $236;
  } else {
   $242 = ((($236)) + 8|0);
   $243 = HEAP32[$242>>2]|0;
   $244 = HEAP32[(44232)>>2]|0;
   $245 = ($243>>>0)<($244>>>0);
   if ($245) {
    _abort();
    // unreachable;
   } else {
    $$pre$phiZ2D = $242;$F18$0 = $243;
   }
  }
  HEAP32[$$pre$phiZ2D>>2] = $p$1;
  $246 = ((($F18$0)) + 12|0);
  HEAP32[$246>>2] = $p$1;
  $247 = ((($p$1)) + 8|0);
  HEAP32[$247>>2] = $F18$0;
  $248 = ((($p$1)) + 12|0);
  HEAP32[$248>>2] = $236;
  return;
 }
 $249 = $psize$2 >>> 8;
 $250 = ($249|0)==(0);
 if ($250) {
  $I20$0 = 0;
 } else {
  $251 = ($psize$2>>>0)>(16777215);
  if ($251) {
   $I20$0 = 31;
  } else {
   $252 = (($249) + 1048320)|0;
   $253 = $252 >>> 16;
   $254 = $253 & 8;
   $255 = $249 << $254;
   $256 = (($255) + 520192)|0;
   $257 = $256 >>> 16;
   $258 = $257 & 4;
   $259 = $258 | $254;
   $260 = $255 << $258;
   $261 = (($260) + 245760)|0;
   $262 = $261 >>> 16;
   $263 = $262 & 2;
   $264 = $259 | $263;
   $265 = (14 - ($264))|0;
   $266 = $260 << $263;
   $267 = $266 >>> 15;
   $268 = (($265) + ($267))|0;
   $269 = $268 << 1;
   $270 = (($268) + 7)|0;
   $271 = $psize$2 >>> $270;
   $272 = $271 & 1;
   $273 = $272 | $269;
   $I20$0 = $273;
  }
 }
 $274 = (44520 + ($I20$0<<2)|0);
 $275 = ((($p$1)) + 28|0);
 HEAP32[$275>>2] = $I20$0;
 $276 = ((($p$1)) + 16|0);
 $277 = ((($p$1)) + 20|0);
 HEAP32[$277>>2] = 0;
 HEAP32[$276>>2] = 0;
 $278 = HEAP32[(44220)>>2]|0;
 $279 = 1 << $I20$0;
 $280 = $278 & $279;
 $281 = ($280|0)==(0);
 do {
  if ($281) {
   $282 = $278 | $279;
   HEAP32[(44220)>>2] = $282;
   HEAP32[$274>>2] = $p$1;
   $283 = ((($p$1)) + 24|0);
   HEAP32[$283>>2] = $274;
   $284 = ((($p$1)) + 12|0);
   HEAP32[$284>>2] = $p$1;
   $285 = ((($p$1)) + 8|0);
   HEAP32[$285>>2] = $p$1;
  } else {
   $286 = HEAP32[$274>>2]|0;
   $287 = ($I20$0|0)==(31);
   $288 = $I20$0 >>> 1;
   $289 = (25 - ($288))|0;
   $290 = $287 ? 0 : $289;
   $291 = $psize$2 << $290;
   $K21$0 = $291;$T$0 = $286;
   while(1) {
    $292 = ((($T$0)) + 4|0);
    $293 = HEAP32[$292>>2]|0;
    $294 = $293 & -8;
    $295 = ($294|0)==($psize$2|0);
    if ($295) {
     $T$0$lcssa = $T$0;
     label = 130;
     break;
    }
    $296 = $K21$0 >>> 31;
    $297 = (((($T$0)) + 16|0) + ($296<<2)|0);
    $298 = $K21$0 << 1;
    $299 = HEAP32[$297>>2]|0;
    $300 = ($299|0)==(0|0);
    if ($300) {
     $$lcssa = $297;$T$0$lcssa48 = $T$0;
     label = 127;
     break;
    } else {
     $K21$0 = $298;$T$0 = $299;
    }
   }
   if ((label|0) == 127) {
    $301 = HEAP32[(44232)>>2]|0;
    $302 = ($$lcssa>>>0)<($301>>>0);
    if ($302) {
     _abort();
     // unreachable;
    } else {
     HEAP32[$$lcssa>>2] = $p$1;
     $303 = ((($p$1)) + 24|0);
     HEAP32[$303>>2] = $T$0$lcssa48;
     $304 = ((($p$1)) + 12|0);
     HEAP32[$304>>2] = $p$1;
     $305 = ((($p$1)) + 8|0);
     HEAP32[$305>>2] = $p$1;
     break;
    }
   }
   else if ((label|0) == 130) {
    $306 = ((($T$0$lcssa)) + 8|0);
    $307 = HEAP32[$306>>2]|0;
    $308 = HEAP32[(44232)>>2]|0;
    $309 = ($307>>>0)>=($308>>>0);
    $not$ = ($T$0$lcssa>>>0)>=($308>>>0);
    $310 = $309 & $not$;
    if ($310) {
     $311 = ((($307)) + 12|0);
     HEAP32[$311>>2] = $p$1;
     HEAP32[$306>>2] = $p$1;
     $312 = ((($p$1)) + 8|0);
     HEAP32[$312>>2] = $307;
     $313 = ((($p$1)) + 12|0);
     HEAP32[$313>>2] = $T$0$lcssa;
     $314 = ((($p$1)) + 24|0);
     HEAP32[$314>>2] = 0;
     break;
    } else {
     _abort();
     // unreachable;
    }
   }
  }
 } while(0);
 $315 = HEAP32[(44248)>>2]|0;
 $316 = (($315) + -1)|0;
 HEAP32[(44248)>>2] = $316;
 $317 = ($316|0)==(0);
 if ($317) {
  $sp$0$in$i = (44672);
 } else {
  return;
 }
 while(1) {
  $sp$0$i = HEAP32[$sp$0$in$i>>2]|0;
  $318 = ($sp$0$i|0)==(0|0);
  $319 = ((($sp$0$i)) + 8|0);
  if ($318) {
   break;
  } else {
   $sp$0$in$i = $319;
  }
 }
 HEAP32[(44248)>>2] = -1;
 return;
}
function __ZNKSt3__121__basic_string_commonILb1EE20__throw_length_errorEv($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 ___assert_fail((3288|0),(3317|0),1164,(3392|0));
 // unreachable;
}
function __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEEC2ERKS5_($this,$__str) {
 $this = $this|0;
 $__str = $__str|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP8[$__str>>0]|0;
 $1 = $0 & 1;
 $2 = ($1<<24>>24)==(0);
 if ($2) {
  ;HEAP32[$this>>2]=HEAP32[$__str>>2]|0;HEAP32[$this+4>>2]=HEAP32[$__str+4>>2]|0;HEAP32[$this+8>>2]=HEAP32[$__str+8>>2]|0;
 } else {
  $3 = ((($__str)) + 8|0);
  $4 = HEAP32[$3>>2]|0;
  $5 = ((($__str)) + 4|0);
  $6 = HEAP32[$5>>2]|0;
  __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6__initEPKcj($this,$4,$6);
 }
 return;
}
function __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6__initEPKcj($this,$__s,$__sz) {
 $this = $this|0;
 $__s = $__s|0;
 $__sz = $__sz|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $__p$0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ($__sz>>>0)>(4294967279);
 if ($0) {
  __ZNKSt3__121__basic_string_commonILb1EE20__throw_length_errorEv($this);
  // unreachable;
 }
 $1 = ($__sz>>>0)<(11);
 if ($1) {
  $2 = $__sz << 1;
  $3 = $2&255;
  HEAP8[$this>>0] = $3;
  $4 = ((($this)) + 1|0);
  $__p$0 = $4;
 } else {
  $5 = (($__sz) + 16)|0;
  $6 = $5 & -16;
  $7 = (__Znwj($6)|0);
  $8 = ((($this)) + 8|0);
  HEAP32[$8>>2] = $7;
  $9 = $6 | 1;
  HEAP32[$this>>2] = $9;
  $10 = ((($this)) + 4|0);
  HEAP32[$10>>2] = $__sz;
  $__p$0 = $7;
 }
 _memcpy(($__p$0|0),($__s|0),($__sz|0))|0;
 $11 = (($__p$0) + ($__sz)|0);
 HEAP8[$11>>0] = 0;
 return;
}
function __ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEED2Ev($this) {
 $this = $this|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP8[$this>>0]|0;
 $1 = $0 & 1;
 $2 = ($1<<24>>24)==(0);
 if (!($2)) {
  $3 = ((($this)) + 8|0);
  $4 = HEAP32[$3>>2]|0;
  __ZdlPv($4);
 }
 return;
}
function __ZL25default_terminate_handlerv() {
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $thrown_object = 0, $vararg_buffer = 0, $vararg_buffer10 = 0;
 var $vararg_buffer3 = 0, $vararg_buffer7 = 0, $vararg_ptr1 = 0, $vararg_ptr2 = 0, $vararg_ptr6 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0;
 $vararg_buffer10 = sp + 32|0;
 $vararg_buffer7 = sp + 24|0;
 $vararg_buffer3 = sp + 16|0;
 $vararg_buffer = sp;
 $thrown_object = sp + 36|0;
 $0 = (___cxa_get_globals_fast()|0);
 $1 = ($0|0)==(0|0);
 if (!($1)) {
  $2 = HEAP32[$0>>2]|0;
  $3 = ($2|0)==(0|0);
  if (!($3)) {
   $4 = ((($2)) + 80|0);
   $5 = ((($2)) + 48|0);
   $6 = $5;
   $7 = $6;
   $8 = HEAP32[$7>>2]|0;
   $9 = (($6) + 4)|0;
   $10 = $9;
   $11 = HEAP32[$10>>2]|0;
   $12 = $8 & -256;
   $13 = ($12|0)==(1126902528);
   $14 = ($11|0)==(1129074247);
   $15 = $13 & $14;
   if (!($15)) {
    $36 = HEAP32[138]|0;
    HEAP32[$vararg_buffer7>>2] = $36;
    _abort_message(3790,$vararg_buffer7);
    // unreachable;
   }
   $16 = ($8|0)==(1126902529);
   $17 = ($11|0)==(1129074247);
   $18 = $16 & $17;
   if ($18) {
    $19 = ((($2)) + 44|0);
    $20 = HEAP32[$19>>2]|0;
    $21 = $20;
   } else {
    $21 = $4;
   }
   HEAP32[$thrown_object>>2] = $21;
   $22 = HEAP32[$2>>2]|0;
   $23 = ((($22)) + 4|0);
   $24 = HEAP32[$23>>2]|0;
   $25 = HEAP32[2]|0;
   $26 = ((($25)) + 16|0);
   $27 = HEAP32[$26>>2]|0;
   $28 = (FUNCTION_TABLE_iiii[$27 & 7](8,$22,$thrown_object)|0);
   if ($28) {
    $29 = HEAP32[$thrown_object>>2]|0;
    $30 = HEAP32[138]|0;
    $31 = HEAP32[$29>>2]|0;
    $32 = ((($31)) + 8|0);
    $33 = HEAP32[$32>>2]|0;
    $34 = (FUNCTION_TABLE_ii[$33 & 3]($29)|0);
    HEAP32[$vararg_buffer>>2] = $30;
    $vararg_ptr1 = ((($vararg_buffer)) + 4|0);
    HEAP32[$vararg_ptr1>>2] = $24;
    $vararg_ptr2 = ((($vararg_buffer)) + 8|0);
    HEAP32[$vararg_ptr2>>2] = $34;
    _abort_message(3704,$vararg_buffer);
    // unreachable;
   } else {
    $35 = HEAP32[138]|0;
    HEAP32[$vararg_buffer3>>2] = $35;
    $vararg_ptr6 = ((($vararg_buffer3)) + 4|0);
    HEAP32[$vararg_ptr6>>2] = $24;
    _abort_message(3749,$vararg_buffer3);
    // unreachable;
   }
  }
 }
 _abort_message(3828,$vararg_buffer10);
 // unreachable;
}
function ___cxa_get_globals_fast() {
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $vararg_buffer = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $vararg_buffer = sp;
 $0 = (_pthread_once((44712|0),(2|0))|0);
 $1 = ($0|0)==(0);
 if ($1) {
  $2 = HEAP32[11179]|0;
  $3 = (_pthread_getspecific(($2|0))|0);
  STACKTOP = sp;return ($3|0);
 } else {
  _abort_message(3516,$vararg_buffer);
  // unreachable;
 }
 return (0)|0;
}
function __ZN10__cxxabiv112_GLOBAL__N_110construct_Ev() {
 var $0 = 0, $1 = 0, $vararg_buffer = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $vararg_buffer = sp;
 $0 = (_pthread_key_create((44716|0),(13|0))|0);
 $1 = ($0|0)==(0);
 if ($1) {
  STACKTOP = sp;return;
 } else {
  _abort_message(3466,$vararg_buffer);
  // unreachable;
 }
}
function __ZN10__cxxabiv112_GLOBAL__N_19destruct_EPv($p) {
 $p = $p|0;
 var $0 = 0, $1 = 0, $2 = 0, $vararg_buffer = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $vararg_buffer = sp;
 _free($p);
 $0 = HEAP32[11179]|0;
 $1 = (_pthread_setspecific(($0|0),(0|0))|0);
 $2 = ($1|0)==(0);
 if ($2) {
  STACKTOP = sp;return;
 } else {
  _abort_message(3413,$vararg_buffer);
  // unreachable;
 }
}
function _abort_message($format,$varargs) {
 $format = $format|0;
 $varargs = $varargs|0;
 var $0 = 0, $list = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $list = sp;
 HEAP32[$list>>2] = $varargs;
 $0 = HEAP32[30]|0;
 (_vfprintf($0,$format,$list)|0);
 (_fputc(10,$0)|0);
 _abort();
 // unreachable;
}
function __ZN10__cxxabiv116__shim_type_infoD2Ev($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZNSt9type_infoD2Ev($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZN10__cxxabiv120__si_class_type_infoD0Ev($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZdlPv($this);
 return;
}
function __ZdlPv($ptr) {
 $ptr = $ptr|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 _free($ptr);
 return;
}
function __ZNK10__cxxabiv116__shim_type_info5noop1Ev($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZNK10__cxxabiv116__shim_type_info5noop2Ev($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZNK10__cxxabiv117__class_type_info9can_catchEPKNS_16__shim_type_infoERPv($this,$thrown_type,$adjustedPtr) {
 $this = $this|0;
 $thrown_type = $thrown_type|0;
 $adjustedPtr = $adjustedPtr|0;
 var $$0 = 0, $$2 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $info = 0, dest = 0;
 var label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 64|0;
 $info = sp;
 $0 = ($this|0)==($thrown_type|0);
 if ($0) {
  $$2 = 1;
 } else {
  $1 = ($thrown_type|0)==(0|0);
  if ($1) {
   $$2 = 0;
  } else {
   $2 = (___dynamic_cast($thrown_type,48,16,0)|0);
   $3 = ($2|0)==(0|0);
   if ($3) {
    $$2 = 0;
   } else {
    dest=$info; stop=dest+56|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
    HEAP32[$info>>2] = $2;
    $4 = ((($info)) + 8|0);
    HEAP32[$4>>2] = $this;
    $5 = ((($info)) + 12|0);
    HEAP32[$5>>2] = -1;
    $6 = ((($info)) + 48|0);
    HEAP32[$6>>2] = 1;
    $7 = HEAP32[$2>>2]|0;
    $8 = ((($7)) + 28|0);
    $9 = HEAP32[$8>>2]|0;
    $10 = HEAP32[$adjustedPtr>>2]|0;
    FUNCTION_TABLE_viiii[$9 & 3]($2,$info,$10,1);
    $11 = ((($info)) + 24|0);
    $12 = HEAP32[$11>>2]|0;
    $13 = ($12|0)==(1);
    if ($13) {
     $14 = ((($info)) + 16|0);
     $15 = HEAP32[$14>>2]|0;
     HEAP32[$adjustedPtr>>2] = $15;
     $$0 = 1;
    } else {
     $$0 = 0;
    }
    $$2 = $$0;
   }
  }
 }
 STACKTOP = sp;return ($$2|0);
}
function ___dynamic_cast($static_ptr,$static_type,$dst_type,$src2dst_offset) {
 $static_ptr = $static_ptr|0;
 $static_type = $static_type|0;
 $dst_type = $dst_type|0;
 $src2dst_offset = $src2dst_offset|0;
 var $$ = 0, $$8 = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0;
 var $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0;
 var $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $dst_ptr$0 = 0, $info = 0, $or$cond = 0, $or$cond3 = 0, $or$cond5 = 0, $or$cond7 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 64|0;
 $info = sp;
 $0 = HEAP32[$static_ptr>>2]|0;
 $1 = ((($0)) + -8|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = (($static_ptr) + ($2)|0);
 $4 = ((($0)) + -4|0);
 $5 = HEAP32[$4>>2]|0;
 HEAP32[$info>>2] = $dst_type;
 $6 = ((($info)) + 4|0);
 HEAP32[$6>>2] = $static_ptr;
 $7 = ((($info)) + 8|0);
 HEAP32[$7>>2] = $static_type;
 $8 = ((($info)) + 12|0);
 HEAP32[$8>>2] = $src2dst_offset;
 $9 = ((($info)) + 16|0);
 $10 = ((($info)) + 20|0);
 $11 = ((($info)) + 24|0);
 $12 = ((($info)) + 28|0);
 $13 = ((($info)) + 32|0);
 $14 = ((($info)) + 40|0);
 $15 = ($5|0)==($dst_type|0);
 dest=$9; stop=dest+36|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));HEAP16[$9+36>>1]=0|0;HEAP8[$9+38>>0]=0|0;
 L1: do {
  if ($15) {
   $16 = ((($info)) + 48|0);
   HEAP32[$16>>2] = 1;
   $17 = HEAP32[$dst_type>>2]|0;
   $18 = ((($17)) + 20|0);
   $19 = HEAP32[$18>>2]|0;
   FUNCTION_TABLE_viiiiii[$19 & 3]($dst_type,$info,$3,$3,1,0);
   $20 = HEAP32[$11>>2]|0;
   $21 = ($20|0)==(1);
   $$ = $21 ? $3 : 0;
   $dst_ptr$0 = $$;
  } else {
   $22 = ((($info)) + 36|0);
   $23 = HEAP32[$5>>2]|0;
   $24 = ((($23)) + 24|0);
   $25 = HEAP32[$24>>2]|0;
   FUNCTION_TABLE_viiiii[$25 & 3]($5,$info,$3,1,0);
   $26 = HEAP32[$22>>2]|0;
   switch ($26|0) {
   case 0:  {
    $27 = HEAP32[$14>>2]|0;
    $28 = ($27|0)==(1);
    $29 = HEAP32[$12>>2]|0;
    $30 = ($29|0)==(1);
    $or$cond = $28 & $30;
    $31 = HEAP32[$13>>2]|0;
    $32 = ($31|0)==(1);
    $or$cond3 = $or$cond & $32;
    $33 = HEAP32[$10>>2]|0;
    $$8 = $or$cond3 ? $33 : 0;
    $dst_ptr$0 = $$8;
    break L1;
    break;
   }
   case 1:  {
    break;
   }
   default: {
    $dst_ptr$0 = 0;
    break L1;
   }
   }
   $34 = HEAP32[$11>>2]|0;
   $35 = ($34|0)==(1);
   if (!($35)) {
    $36 = HEAP32[$14>>2]|0;
    $37 = ($36|0)==(0);
    $38 = HEAP32[$12>>2]|0;
    $39 = ($38|0)==(1);
    $or$cond5 = $37 & $39;
    $40 = HEAP32[$13>>2]|0;
    $41 = ($40|0)==(1);
    $or$cond7 = $or$cond5 & $41;
    if (!($or$cond7)) {
     $dst_ptr$0 = 0;
     break;
    }
   }
   $42 = HEAP32[$9>>2]|0;
   $dst_ptr$0 = $42;
  }
 } while(0);
 STACKTOP = sp;return ($dst_ptr$0|0);
}
function __ZNK10__cxxabiv120__si_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib($this,$info,$dst_ptr,$current_ptr,$path_below,$use_strcmp) {
 $this = $this|0;
 $info = $info|0;
 $dst_ptr = $dst_ptr|0;
 $current_ptr = $current_ptr|0;
 $path_below = $path_below|0;
 $use_strcmp = $use_strcmp|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($info)) + 8|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ($this|0)==($1|0);
 if ($2) {
  __ZNK10__cxxabiv117__class_type_info29process_static_type_above_dstEPNS_19__dynamic_cast_infoEPKvS4_i(0,$info,$dst_ptr,$current_ptr,$path_below);
 } else {
  $3 = ((($this)) + 8|0);
  $4 = HEAP32[$3>>2]|0;
  $5 = HEAP32[$4>>2]|0;
  $6 = ((($5)) + 20|0);
  $7 = HEAP32[$6>>2]|0;
  FUNCTION_TABLE_viiiiii[$7 & 3]($4,$info,$dst_ptr,$current_ptr,$path_below,$use_strcmp);
 }
 return;
}
function __ZNK10__cxxabiv117__class_type_info29process_static_type_above_dstEPNS_19__dynamic_cast_infoEPKvS4_i($this,$info,$dst_ptr,$current_ptr,$path_below) {
 $this = $this|0;
 $info = $info|0;
 $dst_ptr = $dst_ptr|0;
 $current_ptr = $current_ptr|0;
 $path_below = $path_below|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $or$cond = 0, $or$cond1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($info)) + 53|0);
 HEAP8[$0>>0] = 1;
 $1 = ((($info)) + 4|0);
 $2 = HEAP32[$1>>2]|0;
 $3 = ($2|0)==($current_ptr|0);
 do {
  if ($3) {
   $4 = ((($info)) + 52|0);
   HEAP8[$4>>0] = 1;
   $5 = ((($info)) + 16|0);
   $6 = HEAP32[$5>>2]|0;
   $7 = ($6|0)==(0|0);
   if ($7) {
    HEAP32[$5>>2] = $dst_ptr;
    $8 = ((($info)) + 24|0);
    HEAP32[$8>>2] = $path_below;
    $9 = ((($info)) + 36|0);
    HEAP32[$9>>2] = 1;
    $10 = ((($info)) + 48|0);
    $11 = HEAP32[$10>>2]|0;
    $12 = ($11|0)==(1);
    $13 = ($path_below|0)==(1);
    $or$cond = $12 & $13;
    if (!($or$cond)) {
     break;
    }
    $14 = ((($info)) + 54|0);
    HEAP8[$14>>0] = 1;
    break;
   }
   $15 = ($6|0)==($dst_ptr|0);
   if (!($15)) {
    $25 = ((($info)) + 36|0);
    $26 = HEAP32[$25>>2]|0;
    $27 = (($26) + 1)|0;
    HEAP32[$25>>2] = $27;
    $28 = ((($info)) + 54|0);
    HEAP8[$28>>0] = 1;
    break;
   }
   $16 = ((($info)) + 24|0);
   $17 = HEAP32[$16>>2]|0;
   $18 = ($17|0)==(2);
   if ($18) {
    HEAP32[$16>>2] = $path_below;
    $23 = $path_below;
   } else {
    $23 = $17;
   }
   $19 = ((($info)) + 48|0);
   $20 = HEAP32[$19>>2]|0;
   $21 = ($20|0)==(1);
   $22 = ($23|0)==(1);
   $or$cond1 = $21 & $22;
   if ($or$cond1) {
    $24 = ((($info)) + 54|0);
    HEAP8[$24>>0] = 1;
   }
  }
 } while(0);
 return;
}
function __ZNK10__cxxabiv120__si_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib($this,$info,$current_ptr,$path_below,$use_strcmp) {
 $this = $this|0;
 $info = $info|0;
 $current_ptr = $current_ptr|0;
 $path_below = $path_below|0;
 $use_strcmp = $use_strcmp|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0;
 var $45 = 0, $46 = 0, $47 = 0, $48 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $is_dst_type_derived_from_static_type$0$off02 = 0, $not$ = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($info)) + 8|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ($this|0)==($1|0);
 do {
  if ($2) {
   $3 = ((($info)) + 4|0);
   $4 = HEAP32[$3>>2]|0;
   $5 = ($4|0)==($current_ptr|0);
   if ($5) {
    $6 = ((($info)) + 28|0);
    $7 = HEAP32[$6>>2]|0;
    $8 = ($7|0)==(1);
    if (!($8)) {
     HEAP32[$6>>2] = $path_below;
    }
   }
  } else {
   $9 = HEAP32[$info>>2]|0;
   $10 = ($this|0)==($9|0);
   if (!($10)) {
    $44 = ((($this)) + 8|0);
    $45 = HEAP32[$44>>2]|0;
    $46 = HEAP32[$45>>2]|0;
    $47 = ((($46)) + 24|0);
    $48 = HEAP32[$47>>2]|0;
    FUNCTION_TABLE_viiiii[$48 & 3]($45,$info,$current_ptr,$path_below,$use_strcmp);
    break;
   }
   $11 = ((($info)) + 16|0);
   $12 = HEAP32[$11>>2]|0;
   $13 = ($12|0)==($current_ptr|0);
   if (!($13)) {
    $14 = ((($info)) + 20|0);
    $15 = HEAP32[$14>>2]|0;
    $16 = ($15|0)==($current_ptr|0);
    if (!($16)) {
     $19 = ((($info)) + 32|0);
     HEAP32[$19>>2] = $path_below;
     $20 = ((($info)) + 44|0);
     $21 = HEAP32[$20>>2]|0;
     $22 = ($21|0)==(4);
     if ($22) {
      break;
     }
     $23 = ((($info)) + 52|0);
     HEAP8[$23>>0] = 0;
     $24 = ((($info)) + 53|0);
     HEAP8[$24>>0] = 0;
     $25 = ((($this)) + 8|0);
     $26 = HEAP32[$25>>2]|0;
     $27 = HEAP32[$26>>2]|0;
     $28 = ((($27)) + 20|0);
     $29 = HEAP32[$28>>2]|0;
     FUNCTION_TABLE_viiiiii[$29 & 3]($26,$info,$current_ptr,$current_ptr,1,$use_strcmp);
     $30 = HEAP8[$24>>0]|0;
     $31 = ($30<<24>>24)==(0);
     if ($31) {
      $is_dst_type_derived_from_static_type$0$off02 = 0;
      label = 13;
     } else {
      $32 = HEAP8[$23>>0]|0;
      $not$ = ($32<<24>>24)==(0);
      if ($not$) {
       $is_dst_type_derived_from_static_type$0$off02 = 1;
       label = 13;
      } else {
       label = 17;
      }
     }
     do {
      if ((label|0) == 13) {
       HEAP32[$14>>2] = $current_ptr;
       $33 = ((($info)) + 40|0);
       $34 = HEAP32[$33>>2]|0;
       $35 = (($34) + 1)|0;
       HEAP32[$33>>2] = $35;
       $36 = ((($info)) + 36|0);
       $37 = HEAP32[$36>>2]|0;
       $38 = ($37|0)==(1);
       if ($38) {
        $39 = ((($info)) + 24|0);
        $40 = HEAP32[$39>>2]|0;
        $41 = ($40|0)==(2);
        if ($41) {
         $42 = ((($info)) + 54|0);
         HEAP8[$42>>0] = 1;
         if ($is_dst_type_derived_from_static_type$0$off02) {
          label = 17;
          break;
         } else {
          $43 = 4;
          break;
         }
        }
       }
       if ($is_dst_type_derived_from_static_type$0$off02) {
        label = 17;
       } else {
        $43 = 4;
       }
      }
     } while(0);
     if ((label|0) == 17) {
      $43 = 3;
     }
     HEAP32[$20>>2] = $43;
     break;
    }
   }
   $17 = ($path_below|0)==(1);
   if ($17) {
    $18 = ((($info)) + 32|0);
    HEAP32[$18>>2] = 1;
   }
  }
 } while(0);
 return;
}
function __ZNK10__cxxabiv120__si_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi($this,$info,$adjustedPtr,$path_below) {
 $this = $this|0;
 $info = $info|0;
 $adjustedPtr = $adjustedPtr|0;
 $path_below = $path_below|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($info)) + 8|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ($this|0)==($1|0);
 if ($2) {
  __ZNK10__cxxabiv117__class_type_info24process_found_base_classEPNS_19__dynamic_cast_infoEPvi(0,$info,$adjustedPtr,$path_below);
 } else {
  $3 = ((($this)) + 8|0);
  $4 = HEAP32[$3>>2]|0;
  $5 = HEAP32[$4>>2]|0;
  $6 = ((($5)) + 28|0);
  $7 = HEAP32[$6>>2]|0;
  FUNCTION_TABLE_viiii[$7 & 3]($4,$info,$adjustedPtr,$path_below);
 }
 return;
}
function __ZNK10__cxxabiv117__class_type_info24process_found_base_classEPNS_19__dynamic_cast_infoEPvi($this,$info,$adjustedPtr,$path_below) {
 $this = $this|0;
 $info = $info|0;
 $adjustedPtr = $adjustedPtr|0;
 $path_below = $path_below|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($info)) + 16|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ($1|0)==(0|0);
 do {
  if ($2) {
   HEAP32[$0>>2] = $adjustedPtr;
   $3 = ((($info)) + 24|0);
   HEAP32[$3>>2] = $path_below;
   $4 = ((($info)) + 36|0);
   HEAP32[$4>>2] = 1;
  } else {
   $5 = ($1|0)==($adjustedPtr|0);
   if (!($5)) {
    $9 = ((($info)) + 36|0);
    $10 = HEAP32[$9>>2]|0;
    $11 = (($10) + 1)|0;
    HEAP32[$9>>2] = $11;
    $12 = ((($info)) + 24|0);
    HEAP32[$12>>2] = 2;
    $13 = ((($info)) + 54|0);
    HEAP8[$13>>0] = 1;
    break;
   }
   $6 = ((($info)) + 24|0);
   $7 = HEAP32[$6>>2]|0;
   $8 = ($7|0)==(2);
   if ($8) {
    HEAP32[$6>>2] = $path_below;
   }
  }
 } while(0);
 return;
}
function __ZN10__cxxabiv117__class_type_infoD0Ev($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZdlPv($this);
 return;
}
function __ZNK10__cxxabiv117__class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib($this,$info,$dst_ptr,$current_ptr,$path_below,$use_strcmp) {
 $this = $this|0;
 $info = $info|0;
 $dst_ptr = $dst_ptr|0;
 $current_ptr = $current_ptr|0;
 $path_below = $path_below|0;
 $use_strcmp = $use_strcmp|0;
 var $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($info)) + 8|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ($this|0)==($1|0);
 if ($2) {
  __ZNK10__cxxabiv117__class_type_info29process_static_type_above_dstEPNS_19__dynamic_cast_infoEPKvS4_i(0,$info,$dst_ptr,$current_ptr,$path_below);
 }
 return;
}
function __ZNK10__cxxabiv117__class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib($this,$info,$current_ptr,$path_below,$use_strcmp) {
 $this = $this|0;
 $info = $info|0;
 $current_ptr = $current_ptr|0;
 $path_below = $path_below|0;
 $use_strcmp = $use_strcmp|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($info)) + 8|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ($this|0)==($1|0);
 do {
  if ($2) {
   $3 = ((($info)) + 4|0);
   $4 = HEAP32[$3>>2]|0;
   $5 = ($4|0)==($current_ptr|0);
   if ($5) {
    $6 = ((($info)) + 28|0);
    $7 = HEAP32[$6>>2]|0;
    $8 = ($7|0)==(1);
    if (!($8)) {
     HEAP32[$6>>2] = $path_below;
    }
   }
  } else {
   $9 = HEAP32[$info>>2]|0;
   $10 = ($this|0)==($9|0);
   if ($10) {
    $11 = ((($info)) + 16|0);
    $12 = HEAP32[$11>>2]|0;
    $13 = ($12|0)==($current_ptr|0);
    if (!($13)) {
     $14 = ((($info)) + 20|0);
     $15 = HEAP32[$14>>2]|0;
     $16 = ($15|0)==($current_ptr|0);
     if (!($16)) {
      $19 = ((($info)) + 32|0);
      HEAP32[$19>>2] = $path_below;
      HEAP32[$14>>2] = $current_ptr;
      $20 = ((($info)) + 40|0);
      $21 = HEAP32[$20>>2]|0;
      $22 = (($21) + 1)|0;
      HEAP32[$20>>2] = $22;
      $23 = ((($info)) + 36|0);
      $24 = HEAP32[$23>>2]|0;
      $25 = ($24|0)==(1);
      if ($25) {
       $26 = ((($info)) + 24|0);
       $27 = HEAP32[$26>>2]|0;
       $28 = ($27|0)==(2);
       if ($28) {
        $29 = ((($info)) + 54|0);
        HEAP8[$29>>0] = 1;
       }
      }
      $30 = ((($info)) + 44|0);
      HEAP32[$30>>2] = 4;
      break;
     }
    }
    $17 = ($path_below|0)==(1);
    if ($17) {
     $18 = ((($info)) + 32|0);
     HEAP32[$18>>2] = 1;
    }
   }
  }
 } while(0);
 return;
}
function __ZNK10__cxxabiv117__class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi($this,$info,$adjustedPtr,$path_below) {
 $this = $this|0;
 $info = $info|0;
 $adjustedPtr = $adjustedPtr|0;
 $path_below = $path_below|0;
 var $0 = 0, $1 = 0, $2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ((($info)) + 8|0);
 $1 = HEAP32[$0>>2]|0;
 $2 = ($this|0)==($1|0);
 if ($2) {
  __ZNK10__cxxabiv117__class_type_info24process_found_base_classEPNS_19__dynamic_cast_infoEPvi(0,$info,$adjustedPtr,$path_below);
 }
 return;
}
function __ZSt9terminatev() {
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $vararg_buffer = 0;
 var $vararg_buffer1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $vararg_buffer1 = sp + 8|0;
 $vararg_buffer = sp;
 $0 = (___cxa_get_globals_fast()|0);
 $1 = ($0|0)==(0|0);
 if (!($1)) {
  $2 = HEAP32[$0>>2]|0;
  $3 = ($2|0)==(0|0);
  if (!($3)) {
   $4 = ((($2)) + 48|0);
   $5 = $4;
   $6 = $5;
   $7 = HEAP32[$6>>2]|0;
   $8 = (($5) + 4)|0;
   $9 = $8;
   $10 = HEAP32[$9>>2]|0;
   $11 = $7 & -256;
   $12 = ($11|0)==(1126902528);
   $13 = ($10|0)==(1129074247);
   $14 = $12 & $13;
   if ($14) {
    $15 = ((($2)) + 12|0);
    $16 = HEAP32[$15>>2]|0;
    FUNCTION_TABLE_v[$16 & 3]();
    _abort_message(3840,$vararg_buffer);
    // unreachable;
   }
  }
 }
 $17 = HEAP32[117]|0;HEAP32[117] = (($17+0)|0);
 $18 = $17;
 FUNCTION_TABLE_v[$18 & 3]();
 _abort_message(3840,$vararg_buffer1);
 // unreachable;
}
function __ZNSt9bad_allocD2Ev($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZNSt9exceptionD2Ev($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return;
}
function __ZNSt9bad_allocD0Ev($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZdlPv($this);
 return;
}
function __ZNKSt9bad_alloc4whatEv($this) {
 $this = $this|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (3893|0);
}
function __Znwj($size) {
 $size = $size|0;
 var $$lcssa = 0, $$size = 0, $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ($size|0)==(0);
 $$size = $0 ? 1 : $size;
 while(1) {
  $1 = (_malloc($$size)|0);
  $2 = ($1|0)==(0|0);
  if (!($2)) {
   $$lcssa = $1;
   label = 6;
   break;
  }
  $3 = (__ZSt15get_new_handlerv()|0);
  $4 = ($3|0)==(0|0);
  if ($4) {
   label = 5;
   break;
  }
  FUNCTION_TABLE_v[$3 & 3]();
 }
 if ((label|0) == 5) {
  $5 = (___cxa_allocate_exception(4)|0);
  HEAP32[$5>>2] = (564);
  ___cxa_throw(($5|0),(72|0),(6|0));
  // unreachable;
 }
 else if ((label|0) == 6) {
  return ($$lcssa|0);
 }
 return (0)|0;
}
function __ZSt15get_new_handlerv() {
 var $0 = 0, $1 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[11180]|0;HEAP32[11180] = (($0+0)|0);
 $1 = $0;
 return ($1|0);
}
function __Znaj($size) {
 $size = $size|0;
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (__Znwj($size)|0);
 return ($0|0);
}
function __ZdaPv($ptr) {
 $ptr = $ptr|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 __ZdlPv($ptr);
 return;
}
function ___cxa_can_catch($catchType,$excpType,$thrown) {
 $catchType = $catchType|0;
 $excpType = $excpType|0;
 $thrown = $thrown|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $temp = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $temp = sp;
 $0 = HEAP32[$thrown>>2]|0;
 HEAP32[$temp>>2] = $0;
 $1 = HEAP32[$catchType>>2]|0;
 $2 = ((($1)) + 16|0);
 $3 = HEAP32[$2>>2]|0;
 $4 = (FUNCTION_TABLE_iiii[$3 & 7]($catchType,$excpType,$temp)|0);
 $5 = $4&1;
 if ($4) {
  $6 = HEAP32[$temp>>2]|0;
  HEAP32[$thrown>>2] = $6;
 }
 STACKTOP = sp;return ($5|0);
}
function ___cxa_is_pointer_type($type) {
 $type = $type|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $phitmp = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ($type|0)==(0|0);
 if ($0) {
  $3 = 0;
 } else {
  $1 = (___dynamic_cast($type,48,104,0)|0);
  $phitmp = ($1|0)!=(0|0);
  $3 = $phitmp;
 }
 $2 = $3&1;
 return ($2|0);
}
function runPostSets() {
}
function _i64Subtract(a, b, c, d) {
    a = a|0; b = b|0; c = c|0; d = d|0;
    var l = 0, h = 0;
    l = (a - c)>>>0;
    h = (b - d)>>>0;
    h = (b - d - (((c>>>0) > (a>>>0))|0))>>>0; // Borrow one from high word to low word on underflow.
    return ((tempRet0 = h,l|0)|0);
}
function _memset(ptr, value, num) {
    ptr = ptr|0; value = value|0; num = num|0;
    var stop = 0, value4 = 0, stop4 = 0, unaligned = 0;
    stop = (ptr + num)|0;
    if ((num|0) >= 20) {
      // This is unaligned, but quite large, so work hard to get to aligned settings
      value = value & 0xff;
      unaligned = ptr & 3;
      value4 = value | (value << 8) | (value << 16) | (value << 24);
      stop4 = stop & ~3;
      if (unaligned) {
        unaligned = (ptr + 4 - unaligned)|0;
        while ((ptr|0) < (unaligned|0)) { // no need to check for stop, since we have large num
          HEAP8[((ptr)>>0)]=value;
          ptr = (ptr+1)|0;
        }
      }
      while ((ptr|0) < (stop4|0)) {
        HEAP32[((ptr)>>2)]=value4;
        ptr = (ptr+4)|0;
      }
    }
    while ((ptr|0) < (stop|0)) {
      HEAP8[((ptr)>>0)]=value;
      ptr = (ptr+1)|0;
    }
    return (ptr-num)|0;
}
function _bitshift64Shl(low, high, bits) {
    low = low|0; high = high|0; bits = bits|0;
    var ander = 0;
    if ((bits|0) < 32) {
      ander = ((1 << bits) - 1)|0;
      tempRet0 = (high << bits) | ((low&(ander << (32 - bits))) >>> (32 - bits));
      return low << bits;
    }
    tempRet0 = low << (bits - 32);
    return 0;
}
function _i64Add(a, b, c, d) {
    /*
      x = a + b*2^32
      y = c + d*2^32
      result = l + h*2^32
    */
    a = a|0; b = b|0; c = c|0; d = d|0;
    var l = 0, h = 0;
    l = (a + c)>>>0;
    h = (b + d + (((l>>>0) < (a>>>0))|0))>>>0; // Add carry from low word to high word on overflow.
    return ((tempRet0 = h,l|0)|0);
}
function _bitshift64Lshr(low, high, bits) {
    low = low|0; high = high|0; bits = bits|0;
    var ander = 0;
    if ((bits|0) < 32) {
      ander = ((1 << bits) - 1)|0;
      tempRet0 = high >>> bits;
      return (low >>> bits) | ((high&ander) << (32 - bits));
    }
    tempRet0 = 0;
    return (high >>> (bits - 32))|0;
}
function _memcpy(dest, src, num) {
    dest = dest|0; src = src|0; num = num|0;
    var ret = 0;
    if ((num|0) >= 4096) return _emscripten_memcpy_big(dest|0, src|0, num|0)|0;
    ret = dest|0;
    if ((dest&3) == (src&3)) {
      while (dest & 3) {
        if ((num|0) == 0) return ret|0;
        HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
        dest = (dest+1)|0;
        src = (src+1)|0;
        num = (num-1)|0;
      }
      while ((num|0) >= 4) {
        HEAP32[((dest)>>2)]=((HEAP32[((src)>>2)])|0);
        dest = (dest+4)|0;
        src = (src+4)|0;
        num = (num-4)|0;
      }
    }
    while ((num|0) > 0) {
      HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
      dest = (dest+1)|0;
      src = (src+1)|0;
      num = (num-1)|0;
    }
    return ret|0;
}
function _bitshift64Ashr(low, high, bits) {
    low = low|0; high = high|0; bits = bits|0;
    var ander = 0;
    if ((bits|0) < 32) {
      ander = ((1 << bits) - 1)|0;
      tempRet0 = high >> bits;
      return (low >>> bits) | ((high&ander) << (32 - bits));
    }
    tempRet0 = (high|0) < 0 ? -1 : 0;
    return (high >> (bits - 32))|0;
  }
function _llvm_cttz_i32(x) {
    x = x|0;
    var ret = 0;
    ret = ((HEAP8[(((cttz_i8)+(x & 0xff))>>0)])|0);
    if ((ret|0) < 8) return ret|0;
    ret = ((HEAP8[(((cttz_i8)+((x >> 8)&0xff))>>0)])|0);
    if ((ret|0) < 8) return (ret + 8)|0;
    ret = ((HEAP8[(((cttz_i8)+((x >> 16)&0xff))>>0)])|0);
    if ((ret|0) < 8) return (ret + 16)|0;
    return (((HEAP8[(((cttz_i8)+(x >>> 24))>>0)])|0) + 24)|0;
  }

// ======== compiled code from system/lib/compiler-rt , see readme therein
function ___muldsi3($a, $b) {
  $a = $a | 0;
  $b = $b | 0;
  var $1 = 0, $2 = 0, $3 = 0, $6 = 0, $8 = 0, $11 = 0, $12 = 0;
  $1 = $a & 65535;
  $2 = $b & 65535;
  $3 = Math_imul($2, $1) | 0;
  $6 = $a >>> 16;
  $8 = ($3 >>> 16) + (Math_imul($2, $6) | 0) | 0;
  $11 = $b >>> 16;
  $12 = Math_imul($11, $1) | 0;
  return (tempRet0 = (($8 >>> 16) + (Math_imul($11, $6) | 0) | 0) + ((($8 & 65535) + $12 | 0) >>> 16) | 0, 0 | ($8 + $12 << 16 | $3 & 65535)) | 0;
}
function ___divdi3($a$0, $a$1, $b$0, $b$1) {
  $a$0 = $a$0 | 0;
  $a$1 = $a$1 | 0;
  $b$0 = $b$0 | 0;
  $b$1 = $b$1 | 0;
  var $1$0 = 0, $1$1 = 0, $2$0 = 0, $2$1 = 0, $4$0 = 0, $4$1 = 0, $6$0 = 0, $7$0 = 0, $7$1 = 0, $8$0 = 0, $10$0 = 0;
  $1$0 = $a$1 >> 31 | (($a$1 | 0) < 0 ? -1 : 0) << 1;
  $1$1 = (($a$1 | 0) < 0 ? -1 : 0) >> 31 | (($a$1 | 0) < 0 ? -1 : 0) << 1;
  $2$0 = $b$1 >> 31 | (($b$1 | 0) < 0 ? -1 : 0) << 1;
  $2$1 = (($b$1 | 0) < 0 ? -1 : 0) >> 31 | (($b$1 | 0) < 0 ? -1 : 0) << 1;
  $4$0 = _i64Subtract($1$0 ^ $a$0 | 0, $1$1 ^ $a$1 | 0, $1$0 | 0, $1$1 | 0) | 0;
  $4$1 = tempRet0;
  $6$0 = _i64Subtract($2$0 ^ $b$0 | 0, $2$1 ^ $b$1 | 0, $2$0 | 0, $2$1 | 0) | 0;
  $7$0 = $2$0 ^ $1$0;
  $7$1 = $2$1 ^ $1$1;
  $8$0 = ___udivmoddi4($4$0, $4$1, $6$0, tempRet0, 0) | 0;
  $10$0 = _i64Subtract($8$0 ^ $7$0 | 0, tempRet0 ^ $7$1 | 0, $7$0 | 0, $7$1 | 0) | 0;
  return $10$0 | 0;
}
function ___remdi3($a$0, $a$1, $b$0, $b$1) {
  $a$0 = $a$0 | 0;
  $a$1 = $a$1 | 0;
  $b$0 = $b$0 | 0;
  $b$1 = $b$1 | 0;
  var $rem = 0, $1$0 = 0, $1$1 = 0, $2$0 = 0, $2$1 = 0, $4$0 = 0, $4$1 = 0, $6$0 = 0, $10$0 = 0, $10$1 = 0, __stackBase__ = 0;
  __stackBase__ = STACKTOP;
  STACKTOP = STACKTOP + 16 | 0;
  $rem = __stackBase__ | 0;
  $1$0 = $a$1 >> 31 | (($a$1 | 0) < 0 ? -1 : 0) << 1;
  $1$1 = (($a$1 | 0) < 0 ? -1 : 0) >> 31 | (($a$1 | 0) < 0 ? -1 : 0) << 1;
  $2$0 = $b$1 >> 31 | (($b$1 | 0) < 0 ? -1 : 0) << 1;
  $2$1 = (($b$1 | 0) < 0 ? -1 : 0) >> 31 | (($b$1 | 0) < 0 ? -1 : 0) << 1;
  $4$0 = _i64Subtract($1$0 ^ $a$0 | 0, $1$1 ^ $a$1 | 0, $1$0 | 0, $1$1 | 0) | 0;
  $4$1 = tempRet0;
  $6$0 = _i64Subtract($2$0 ^ $b$0 | 0, $2$1 ^ $b$1 | 0, $2$0 | 0, $2$1 | 0) | 0;
  ___udivmoddi4($4$0, $4$1, $6$0, tempRet0, $rem) | 0;
  $10$0 = _i64Subtract(HEAP32[$rem >> 2] ^ $1$0 | 0, HEAP32[$rem + 4 >> 2] ^ $1$1 | 0, $1$0 | 0, $1$1 | 0) | 0;
  $10$1 = tempRet0;
  STACKTOP = __stackBase__;
  return (tempRet0 = $10$1, $10$0) | 0;
}
function ___muldi3($a$0, $a$1, $b$0, $b$1) {
  $a$0 = $a$0 | 0;
  $a$1 = $a$1 | 0;
  $b$0 = $b$0 | 0;
  $b$1 = $b$1 | 0;
  var $x_sroa_0_0_extract_trunc = 0, $y_sroa_0_0_extract_trunc = 0, $1$0 = 0, $1$1 = 0, $2 = 0;
  $x_sroa_0_0_extract_trunc = $a$0;
  $y_sroa_0_0_extract_trunc = $b$0;
  $1$0 = ___muldsi3($x_sroa_0_0_extract_trunc, $y_sroa_0_0_extract_trunc) | 0;
  $1$1 = tempRet0;
  $2 = Math_imul($a$1, $y_sroa_0_0_extract_trunc) | 0;
  return (tempRet0 = ((Math_imul($b$1, $x_sroa_0_0_extract_trunc) | 0) + $2 | 0) + $1$1 | $1$1 & 0, 0 | $1$0 & -1) | 0;
}
function ___udivdi3($a$0, $a$1, $b$0, $b$1) {
  $a$0 = $a$0 | 0;
  $a$1 = $a$1 | 0;
  $b$0 = $b$0 | 0;
  $b$1 = $b$1 | 0;
  var $1$0 = 0;
  $1$0 = ___udivmoddi4($a$0, $a$1, $b$0, $b$1, 0) | 0;
  return $1$0 | 0;
}
function ___uremdi3($a$0, $a$1, $b$0, $b$1) {
  $a$0 = $a$0 | 0;
  $a$1 = $a$1 | 0;
  $b$0 = $b$0 | 0;
  $b$1 = $b$1 | 0;
  var $rem = 0, __stackBase__ = 0;
  __stackBase__ = STACKTOP;
  STACKTOP = STACKTOP + 16 | 0;
  $rem = __stackBase__ | 0;
  ___udivmoddi4($a$0, $a$1, $b$0, $b$1, $rem) | 0;
  STACKTOP = __stackBase__;
  return (tempRet0 = HEAP32[$rem + 4 >> 2] | 0, HEAP32[$rem >> 2] | 0) | 0;
}
function ___udivmoddi4($a$0, $a$1, $b$0, $b$1, $rem) {
  $a$0 = $a$0 | 0;
  $a$1 = $a$1 | 0;
  $b$0 = $b$0 | 0;
  $b$1 = $b$1 | 0;
  $rem = $rem | 0;
  var $n_sroa_0_0_extract_trunc = 0, $n_sroa_1_4_extract_shift$0 = 0, $n_sroa_1_4_extract_trunc = 0, $d_sroa_0_0_extract_trunc = 0, $d_sroa_1_4_extract_shift$0 = 0, $d_sroa_1_4_extract_trunc = 0, $4 = 0, $17 = 0, $37 = 0, $49 = 0, $51 = 0, $57 = 0, $58 = 0, $66 = 0, $78 = 0, $86 = 0, $88 = 0, $89 = 0, $91 = 0, $92 = 0, $95 = 0, $105 = 0, $117 = 0, $119 = 0, $125 = 0, $126 = 0, $130 = 0, $q_sroa_1_1_ph = 0, $q_sroa_0_1_ph = 0, $r_sroa_1_1_ph = 0, $r_sroa_0_1_ph = 0, $sr_1_ph = 0, $d_sroa_0_0_insert_insert99$0 = 0, $d_sroa_0_0_insert_insert99$1 = 0, $137$0 = 0, $137$1 = 0, $carry_0203 = 0, $sr_1202 = 0, $r_sroa_0_1201 = 0, $r_sroa_1_1200 = 0, $q_sroa_0_1199 = 0, $q_sroa_1_1198 = 0, $147 = 0, $149 = 0, $r_sroa_0_0_insert_insert42$0 = 0, $r_sroa_0_0_insert_insert42$1 = 0, $150$1 = 0, $151$0 = 0, $152 = 0, $154$0 = 0, $r_sroa_0_0_extract_trunc = 0, $r_sroa_1_4_extract_trunc = 0, $155 = 0, $carry_0_lcssa$0 = 0, $carry_0_lcssa$1 = 0, $r_sroa_0_1_lcssa = 0, $r_sroa_1_1_lcssa = 0, $q_sroa_0_1_lcssa = 0, $q_sroa_1_1_lcssa = 0, $q_sroa_0_0_insert_ext75$0 = 0, $q_sroa_0_0_insert_ext75$1 = 0, $q_sroa_0_0_insert_insert77$1 = 0, $_0$0 = 0, $_0$1 = 0;
  $n_sroa_0_0_extract_trunc = $a$0;
  $n_sroa_1_4_extract_shift$0 = $a$1;
  $n_sroa_1_4_extract_trunc = $n_sroa_1_4_extract_shift$0;
  $d_sroa_0_0_extract_trunc = $b$0;
  $d_sroa_1_4_extract_shift$0 = $b$1;
  $d_sroa_1_4_extract_trunc = $d_sroa_1_4_extract_shift$0;
  if (($n_sroa_1_4_extract_trunc | 0) == 0) {
    $4 = ($rem | 0) != 0;
    if (($d_sroa_1_4_extract_trunc | 0) == 0) {
      if ($4) {
        HEAP32[$rem >> 2] = ($n_sroa_0_0_extract_trunc >>> 0) % ($d_sroa_0_0_extract_trunc >>> 0);
        HEAP32[$rem + 4 >> 2] = 0;
      }
      $_0$1 = 0;
      $_0$0 = ($n_sroa_0_0_extract_trunc >>> 0) / ($d_sroa_0_0_extract_trunc >>> 0) >>> 0;
      return (tempRet0 = $_0$1, $_0$0) | 0;
    } else {
      if (!$4) {
        $_0$1 = 0;
        $_0$0 = 0;
        return (tempRet0 = $_0$1, $_0$0) | 0;
      }
      HEAP32[$rem >> 2] = $a$0 & -1;
      HEAP32[$rem + 4 >> 2] = $a$1 & 0;
      $_0$1 = 0;
      $_0$0 = 0;
      return (tempRet0 = $_0$1, $_0$0) | 0;
    }
  }
  $17 = ($d_sroa_1_4_extract_trunc | 0) == 0;
  do {
    if (($d_sroa_0_0_extract_trunc | 0) == 0) {
      if ($17) {
        if (($rem | 0) != 0) {
          HEAP32[$rem >> 2] = ($n_sroa_1_4_extract_trunc >>> 0) % ($d_sroa_0_0_extract_trunc >>> 0);
          HEAP32[$rem + 4 >> 2] = 0;
        }
        $_0$1 = 0;
        $_0$0 = ($n_sroa_1_4_extract_trunc >>> 0) / ($d_sroa_0_0_extract_trunc >>> 0) >>> 0;
        return (tempRet0 = $_0$1, $_0$0) | 0;
      }
      if (($n_sroa_0_0_extract_trunc | 0) == 0) {
        if (($rem | 0) != 0) {
          HEAP32[$rem >> 2] = 0;
          HEAP32[$rem + 4 >> 2] = ($n_sroa_1_4_extract_trunc >>> 0) % ($d_sroa_1_4_extract_trunc >>> 0);
        }
        $_0$1 = 0;
        $_0$0 = ($n_sroa_1_4_extract_trunc >>> 0) / ($d_sroa_1_4_extract_trunc >>> 0) >>> 0;
        return (tempRet0 = $_0$1, $_0$0) | 0;
      }
      $37 = $d_sroa_1_4_extract_trunc - 1 | 0;
      if (($37 & $d_sroa_1_4_extract_trunc | 0) == 0) {
        if (($rem | 0) != 0) {
          HEAP32[$rem >> 2] = 0 | $a$0 & -1;
          HEAP32[$rem + 4 >> 2] = $37 & $n_sroa_1_4_extract_trunc | $a$1 & 0;
        }
        $_0$1 = 0;
        $_0$0 = $n_sroa_1_4_extract_trunc >>> ((_llvm_cttz_i32($d_sroa_1_4_extract_trunc | 0) | 0) >>> 0);
        return (tempRet0 = $_0$1, $_0$0) | 0;
      }
      $49 = Math_clz32($d_sroa_1_4_extract_trunc | 0) | 0;
      $51 = $49 - (Math_clz32($n_sroa_1_4_extract_trunc | 0) | 0) | 0;
      if ($51 >>> 0 <= 30) {
        $57 = $51 + 1 | 0;
        $58 = 31 - $51 | 0;
        $sr_1_ph = $57;
        $r_sroa_0_1_ph = $n_sroa_1_4_extract_trunc << $58 | $n_sroa_0_0_extract_trunc >>> ($57 >>> 0);
        $r_sroa_1_1_ph = $n_sroa_1_4_extract_trunc >>> ($57 >>> 0);
        $q_sroa_0_1_ph = 0;
        $q_sroa_1_1_ph = $n_sroa_0_0_extract_trunc << $58;
        break;
      }
      if (($rem | 0) == 0) {
        $_0$1 = 0;
        $_0$0 = 0;
        return (tempRet0 = $_0$1, $_0$0) | 0;
      }
      HEAP32[$rem >> 2] = 0 | $a$0 & -1;
      HEAP32[$rem + 4 >> 2] = $n_sroa_1_4_extract_shift$0 | $a$1 & 0;
      $_0$1 = 0;
      $_0$0 = 0;
      return (tempRet0 = $_0$1, $_0$0) | 0;
    } else {
      if (!$17) {
        $117 = Math_clz32($d_sroa_1_4_extract_trunc | 0) | 0;
        $119 = $117 - (Math_clz32($n_sroa_1_4_extract_trunc | 0) | 0) | 0;
        if ($119 >>> 0 <= 31) {
          $125 = $119 + 1 | 0;
          $126 = 31 - $119 | 0;
          $130 = $119 - 31 >> 31;
          $sr_1_ph = $125;
          $r_sroa_0_1_ph = $n_sroa_0_0_extract_trunc >>> ($125 >>> 0) & $130 | $n_sroa_1_4_extract_trunc << $126;
          $r_sroa_1_1_ph = $n_sroa_1_4_extract_trunc >>> ($125 >>> 0) & $130;
          $q_sroa_0_1_ph = 0;
          $q_sroa_1_1_ph = $n_sroa_0_0_extract_trunc << $126;
          break;
        }
        if (($rem | 0) == 0) {
          $_0$1 = 0;
          $_0$0 = 0;
          return (tempRet0 = $_0$1, $_0$0) | 0;
        }
        HEAP32[$rem >> 2] = 0 | $a$0 & -1;
        HEAP32[$rem + 4 >> 2] = $n_sroa_1_4_extract_shift$0 | $a$1 & 0;
        $_0$1 = 0;
        $_0$0 = 0;
        return (tempRet0 = $_0$1, $_0$0) | 0;
      }
      $66 = $d_sroa_0_0_extract_trunc - 1 | 0;
      if (($66 & $d_sroa_0_0_extract_trunc | 0) != 0) {
        $86 = (Math_clz32($d_sroa_0_0_extract_trunc | 0) | 0) + 33 | 0;
        $88 = $86 - (Math_clz32($n_sroa_1_4_extract_trunc | 0) | 0) | 0;
        $89 = 64 - $88 | 0;
        $91 = 32 - $88 | 0;
        $92 = $91 >> 31;
        $95 = $88 - 32 | 0;
        $105 = $95 >> 31;
        $sr_1_ph = $88;
        $r_sroa_0_1_ph = $91 - 1 >> 31 & $n_sroa_1_4_extract_trunc >>> ($95 >>> 0) | ($n_sroa_1_4_extract_trunc << $91 | $n_sroa_0_0_extract_trunc >>> ($88 >>> 0)) & $105;
        $r_sroa_1_1_ph = $105 & $n_sroa_1_4_extract_trunc >>> ($88 >>> 0);
        $q_sroa_0_1_ph = $n_sroa_0_0_extract_trunc << $89 & $92;
        $q_sroa_1_1_ph = ($n_sroa_1_4_extract_trunc << $89 | $n_sroa_0_0_extract_trunc >>> ($95 >>> 0)) & $92 | $n_sroa_0_0_extract_trunc << $91 & $88 - 33 >> 31;
        break;
      }
      if (($rem | 0) != 0) {
        HEAP32[$rem >> 2] = $66 & $n_sroa_0_0_extract_trunc;
        HEAP32[$rem + 4 >> 2] = 0;
      }
      if (($d_sroa_0_0_extract_trunc | 0) == 1) {
        $_0$1 = $n_sroa_1_4_extract_shift$0 | $a$1 & 0;
        $_0$0 = 0 | $a$0 & -1;
        return (tempRet0 = $_0$1, $_0$0) | 0;
      } else {
        $78 = _llvm_cttz_i32($d_sroa_0_0_extract_trunc | 0) | 0;
        $_0$1 = 0 | $n_sroa_1_4_extract_trunc >>> ($78 >>> 0);
        $_0$0 = $n_sroa_1_4_extract_trunc << 32 - $78 | $n_sroa_0_0_extract_trunc >>> ($78 >>> 0) | 0;
        return (tempRet0 = $_0$1, $_0$0) | 0;
      }
    }
  } while (0);
  if (($sr_1_ph | 0) == 0) {
    $q_sroa_1_1_lcssa = $q_sroa_1_1_ph;
    $q_sroa_0_1_lcssa = $q_sroa_0_1_ph;
    $r_sroa_1_1_lcssa = $r_sroa_1_1_ph;
    $r_sroa_0_1_lcssa = $r_sroa_0_1_ph;
    $carry_0_lcssa$1 = 0;
    $carry_0_lcssa$0 = 0;
  } else {
    $d_sroa_0_0_insert_insert99$0 = 0 | $b$0 & -1;
    $d_sroa_0_0_insert_insert99$1 = $d_sroa_1_4_extract_shift$0 | $b$1 & 0;
    $137$0 = _i64Add($d_sroa_0_0_insert_insert99$0 | 0, $d_sroa_0_0_insert_insert99$1 | 0, -1, -1) | 0;
    $137$1 = tempRet0;
    $q_sroa_1_1198 = $q_sroa_1_1_ph;
    $q_sroa_0_1199 = $q_sroa_0_1_ph;
    $r_sroa_1_1200 = $r_sroa_1_1_ph;
    $r_sroa_0_1201 = $r_sroa_0_1_ph;
    $sr_1202 = $sr_1_ph;
    $carry_0203 = 0;
    while (1) {
      $147 = $q_sroa_0_1199 >>> 31 | $q_sroa_1_1198 << 1;
      $149 = $carry_0203 | $q_sroa_0_1199 << 1;
      $r_sroa_0_0_insert_insert42$0 = 0 | ($r_sroa_0_1201 << 1 | $q_sroa_1_1198 >>> 31);
      $r_sroa_0_0_insert_insert42$1 = $r_sroa_0_1201 >>> 31 | $r_sroa_1_1200 << 1 | 0;
      _i64Subtract($137$0 | 0, $137$1 | 0, $r_sroa_0_0_insert_insert42$0 | 0, $r_sroa_0_0_insert_insert42$1 | 0) | 0;
      $150$1 = tempRet0;
      $151$0 = $150$1 >> 31 | (($150$1 | 0) < 0 ? -1 : 0) << 1;
      $152 = $151$0 & 1;
      $154$0 = _i64Subtract($r_sroa_0_0_insert_insert42$0 | 0, $r_sroa_0_0_insert_insert42$1 | 0, $151$0 & $d_sroa_0_0_insert_insert99$0 | 0, ((($150$1 | 0) < 0 ? -1 : 0) >> 31 | (($150$1 | 0) < 0 ? -1 : 0) << 1) & $d_sroa_0_0_insert_insert99$1 | 0) | 0;
      $r_sroa_0_0_extract_trunc = $154$0;
      $r_sroa_1_4_extract_trunc = tempRet0;
      $155 = $sr_1202 - 1 | 0;
      if (($155 | 0) == 0) {
        break;
      } else {
        $q_sroa_1_1198 = $147;
        $q_sroa_0_1199 = $149;
        $r_sroa_1_1200 = $r_sroa_1_4_extract_trunc;
        $r_sroa_0_1201 = $r_sroa_0_0_extract_trunc;
        $sr_1202 = $155;
        $carry_0203 = $152;
      }
    }
    $q_sroa_1_1_lcssa = $147;
    $q_sroa_0_1_lcssa = $149;
    $r_sroa_1_1_lcssa = $r_sroa_1_4_extract_trunc;
    $r_sroa_0_1_lcssa = $r_sroa_0_0_extract_trunc;
    $carry_0_lcssa$1 = 0;
    $carry_0_lcssa$0 = $152;
  }
  $q_sroa_0_0_insert_ext75$0 = $q_sroa_0_1_lcssa;
  $q_sroa_0_0_insert_ext75$1 = 0;
  $q_sroa_0_0_insert_insert77$1 = $q_sroa_1_1_lcssa | $q_sroa_0_0_insert_ext75$1;
  if (($rem | 0) != 0) {
    HEAP32[$rem >> 2] = 0 | $r_sroa_0_1_lcssa;
    HEAP32[$rem + 4 >> 2] = $r_sroa_1_1_lcssa | 0;
  }
  $_0$1 = (0 | $q_sroa_0_0_insert_ext75$0) >>> 31 | $q_sroa_0_0_insert_insert77$1 << 1 | ($q_sroa_0_0_insert_ext75$1 << 1 | $q_sroa_0_0_insert_ext75$0 >>> 31) & 0 | $carry_0_lcssa$1;
  $_0$0 = ($q_sroa_0_0_insert_ext75$0 << 1 | 0 >>> 31) & -2 | $carry_0_lcssa$0;
  return (tempRet0 = $_0$1, $_0$0) | 0;
}
// =======================================================================



  
function dynCall_iiii(index,a1,a2,a3) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0;
  return FUNCTION_TABLE_iiii[index&7](a1|0,a2|0,a3|0)|0;
}


function dynCall_viiiii(index,a1,a2,a3,a4,a5) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0;
  FUNCTION_TABLE_viiiii[index&3](a1|0,a2|0,a3|0,a4|0,a5|0);
}


function dynCall_i(index) {
  index = index|0;
  
  return FUNCTION_TABLE_i[index&15]()|0;
}


function dynCall_vi(index,a1) {
  index = index|0;
  a1=a1|0;
  FUNCTION_TABLE_vi[index&15](a1|0);
}


function dynCall_ii(index,a1) {
  index = index|0;
  a1=a1|0;
  return FUNCTION_TABLE_ii[index&3](a1|0)|0;
}


function dynCall_v(index) {
  index = index|0;
  
  FUNCTION_TABLE_v[index&3]();
}


function dynCall_viiiiii(index,a1,a2,a3,a4,a5,a6) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0; a5=a5|0; a6=a6|0;
  FUNCTION_TABLE_viiiiii[index&3](a1|0,a2|0,a3|0,a4|0,a5|0,a6|0);
}


function dynCall_iii(index,a1,a2) {
  index = index|0;
  a1=a1|0; a2=a2|0;
  return FUNCTION_TABLE_iii[index&31](a1|0,a2|0)|0;
}


function dynCall_viiii(index,a1,a2,a3,a4) {
  index = index|0;
  a1=a1|0; a2=a2|0; a3=a3|0; a4=a4|0;
  FUNCTION_TABLE_viiii[index&3](a1|0,a2|0,a3|0,a4|0);
}

function b0(p0,p1,p2) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0; abort(0);return 0;
}
function b1(p0,p1,p2,p3,p4) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0;p3 = p3|0;p4 = p4|0; abort(1);
}
function b2() {
 ; abort(2);return 0;
}
function b3(p0) {
 p0 = p0|0; abort(3);
}
function b4(p0) {
 p0 = p0|0; abort(4);return 0;
}
function b5() {
 ; abort(5);
}
function b6(p0,p1,p2,p3,p4,p5) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0;p3 = p3|0;p4 = p4|0;p5 = p5|0; abort(6);
}
function b7(p0,p1) {
 p0 = p0|0;p1 = p1|0; abort(7);return 0;
}
function b8(p0,p1,p2,p3) {
 p0 = p0|0;p1 = p1|0;p2 = p2|0;p3 = p3|0; abort(8);
}

// EMSCRIPTEN_END_FUNCS
var FUNCTION_TABLE_iiii = [b0,___stdio_write,___stdio_seek,___stdout_write,_sn_write,__ZNK10__cxxabiv117__class_type_info9can_catchEPKNS_16__shim_type_infoERPv,b0,b0];
var FUNCTION_TABLE_viiiii = [b1,__ZNK10__cxxabiv117__class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib,__ZNK10__cxxabiv120__si_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib,b1];
var FUNCTION_TABLE_i = [b2,__ZN16AverageFloat32x49initArrayEv,__ZN16AverageFloat32x47cleanupEv,__ZN10Mandelbrot14initMandelbrotEv,__ZN10Mandelbrot17cleanupMandelbrotEv,__ZN20MatrixMultiplication4initEv,__ZN20MatrixMultiplication7cleanupEv,__ZN15VertexTransform4initEv,__ZN15VertexTransform7cleanupEv,__ZN15MatrixTranspose4initEv,__ZN15MatrixTranspose7cleanupEv,__ZN13MatrixInverse4initEv,__ZN13MatrixInverse7cleanupEv,b2,b2,b2];
var FUNCTION_TABLE_vi = [b3,__ZN10__cxxabiv116__shim_type_infoD2Ev,__ZN10__cxxabiv117__class_type_infoD0Ev,__ZNK10__cxxabiv116__shim_type_info5noop1Ev,__ZNK10__cxxabiv116__shim_type_info5noop2Ev,__ZN10__cxxabiv120__si_class_type_infoD0Ev,__ZNSt9bad_allocD2Ev,__ZNSt9bad_allocD0Ev,__Z11printResultPc,__Z10printErrorPc,__Z10printScorePc,__ZNSt3__110__list_impIPN4Base9BenchmarkENS_9allocatorIS3_EEED2Ev,_cleanup_522,__ZN10__cxxabiv112_GLOBAL__N_19destruct_EPv,b3,b3];
var FUNCTION_TABLE_ii = [b4,___stdio_close,__ZNKSt9bad_alloc4whatEv,b4];
var FUNCTION_TABLE_v = [b5,__ZL25default_terminate_handlerv,__ZN10__cxxabiv112_GLOBAL__N_110construct_Ev,b5];
var FUNCTION_TABLE_viiiiii = [b6,__ZNK10__cxxabiv117__class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib,__ZNK10__cxxabiv120__si_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib,b6];
var FUNCTION_TABLE_iii = [b7,__ZN16AverageFloat32x411simdAverageEy,__ZN16AverageFloat32x49average32Ey,__ZN16AverageFloat32x49average64Ey,__ZN10Mandelbrot14simdMandelbrotEy,__ZN10Mandelbrot19nonSimdMandelbrot32Ey,__ZN10Mandelbrot19nonSimdMandelbrot64Ey,__ZN20MatrixMultiplication12simdMultiplyEy,__ZN20MatrixMultiplication10multiply32Ey,__ZN20MatrixMultiplication10multiply64Ey,__ZN15VertexTransform20simdVertextTransformEy,__ZN15VertexTransform18vertextTransform32Ey,__ZN15VertexTransform18vertextTransform64Ey,__ZN15MatrixTranspose13simdTransposeEy,__ZN15MatrixTranspose11transpose32Ey,__ZN15MatrixTranspose11transpose64Ey,__ZN13MatrixInverse17simdMatrixInverseEy,__ZN13MatrixInverse15matrixInverse32Ey,__ZN13MatrixInverse15matrixInverse64Ey,b7,b7,b7,b7,b7,b7,b7,b7,b7,b7
,b7,b7,b7];
var FUNCTION_TABLE_viiii = [b8,__ZNK10__cxxabiv117__class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi,__ZNK10__cxxabiv120__si_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi,b8];

  return { ___cxa_can_catch: ___cxa_can_catch, _free: _free, _main: _main, ___cxa_is_pointer_type: ___cxa_is_pointer_type, _i64Add: _i64Add, _i64Subtract: _i64Subtract, _memset: _memset, _malloc: _malloc, _memcpy: _memcpy, _bitshift64Lshr: _bitshift64Lshr, _fflush: _fflush, ___errno_location: ___errno_location, _bitshift64Shl: _bitshift64Shl, __GLOBAL__sub_I_base_cpp: __GLOBAL__sub_I_base_cpp, runPostSets: runPostSets, stackAlloc: stackAlloc, stackSave: stackSave, stackRestore: stackRestore, establishStackSpace: establishStackSpace, setThrew: setThrew, setTempRet0: setTempRet0, getTempRet0: getTempRet0, dynCall_iiii: dynCall_iiii, dynCall_viiiii: dynCall_viiiii, dynCall_i: dynCall_i, dynCall_vi: dynCall_vi, dynCall_ii: dynCall_ii, dynCall_v: dynCall_v, dynCall_viiiiii: dynCall_viiiiii, dynCall_iii: dynCall_iii, dynCall_viiii: dynCall_viiii };
})
// EMSCRIPTEN_END_ASM
(Module.asmGlobalArg, Module.asmLibraryArg, buffer);
var ___cxa_can_catch = Module["___cxa_can_catch"] = asm["___cxa_can_catch"];
var _free = Module["_free"] = asm["_free"];
var _main = Module["_main"] = asm["_main"];
var ___cxa_is_pointer_type = Module["___cxa_is_pointer_type"] = asm["___cxa_is_pointer_type"];
var _i64Add = Module["_i64Add"] = asm["_i64Add"];
var runPostSets = Module["runPostSets"] = asm["runPostSets"];
var _i64Subtract = Module["_i64Subtract"] = asm["_i64Subtract"];
var _memset = Module["_memset"] = asm["_memset"];
var _malloc = Module["_malloc"] = asm["_malloc"];
var _memcpy = Module["_memcpy"] = asm["_memcpy"];
var __GLOBAL__sub_I_base_cpp = Module["__GLOBAL__sub_I_base_cpp"] = asm["__GLOBAL__sub_I_base_cpp"];
var _bitshift64Lshr = Module["_bitshift64Lshr"] = asm["_bitshift64Lshr"];
var _fflush = Module["_fflush"] = asm["_fflush"];
var ___errno_location = Module["___errno_location"] = asm["___errno_location"];
var _bitshift64Shl = Module["_bitshift64Shl"] = asm["_bitshift64Shl"];
var dynCall_iiii = Module["dynCall_iiii"] = asm["dynCall_iiii"];
var dynCall_viiiii = Module["dynCall_viiiii"] = asm["dynCall_viiiii"];
var dynCall_i = Module["dynCall_i"] = asm["dynCall_i"];
var dynCall_vi = Module["dynCall_vi"] = asm["dynCall_vi"];
var dynCall_ii = Module["dynCall_ii"] = asm["dynCall_ii"];
var dynCall_v = Module["dynCall_v"] = asm["dynCall_v"];
var dynCall_viiiiii = Module["dynCall_viiiiii"] = asm["dynCall_viiiiii"];
var dynCall_iii = Module["dynCall_iii"] = asm["dynCall_iii"];
var dynCall_viiii = Module["dynCall_viiii"] = asm["dynCall_viiii"];
;

Runtime.stackAlloc = asm['stackAlloc'];
Runtime.stackSave = asm['stackSave'];
Runtime.stackRestore = asm['stackRestore'];
Runtime.establishStackSpace = asm['establishStackSpace'];

Runtime.setTempRet0 = asm['setTempRet0'];
Runtime.getTempRet0 = asm['getTempRet0'];



// === Auto-generated postamble setup entry stuff ===




function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
};
ExitStatus.prototype = new Error();
ExitStatus.prototype.constructor = ExitStatus;

var initialStackTop;
var preloadStartTime = null;
var calledMain = false;

dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!Module['calledRun']) run();
  if (!Module['calledRun']) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
}

Module['callMain'] = Module.callMain = function callMain(args) {

  args = args || [];

  ensureInitRuntime();

  var argc = args.length+1;
  function pad() {
    for (var i = 0; i < 4-1; i++) {
      argv.push(0);
    }
  }
  var argv = [allocate(intArrayFromString(Module['thisProgram']), 'i8', ALLOC_NORMAL) ];
  pad();
  for (var i = 0; i < argc-1; i = i + 1) {
    argv.push(allocate(intArrayFromString(args[i]), 'i8', ALLOC_NORMAL));
    pad();
  }
  argv.push(0);
  argv = allocate(argv, 'i32', ALLOC_NORMAL);


  try {

    var ret = Module['_main'](argc, argv, 0);


    // if we're not running an evented main loop, it's time to exit
    exit(ret, /* implicit = */ true);
  }
  catch(e) {
    if (e instanceof ExitStatus) {
      // exit() throws this once it's done to make sure execution
      // has been stopped completely
      return;
    } else if (e == 'SimulateInfiniteLoop') {
      // running an evented main loop, don't immediately exit
      Module['noExitRuntime'] = true;
      return;
    } else {
      if (e && typeof e === 'object' && e.stack) Module.printErr('exception thrown: ' + [e, e.stack]);
      throw e;
    }
  } finally {
    calledMain = true;
  }
}




function run(args) {
  args = args || Module['arguments'];

  if (preloadStartTime === null) preloadStartTime = Date.now();

  if (runDependencies > 0) {
    return;
  }

  preRun();

  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later
  if (Module['calledRun']) return; // run may have just been called through dependencies being fulfilled just in this very frame

  function doRun() {
    if (Module['calledRun']) return; // run may have just been called while the async setStatus time below was happening
    Module['calledRun'] = true;

    if (ABORT) return; 

    ensureInitRuntime();

    preMain();


    if (Module['onRuntimeInitialized']) Module['onRuntimeInitialized']();

    if (Module['_main'] && shouldRunNow) Module['callMain'](args);

    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      doRun();
    }, 1);
  } else {
    doRun();
  }
}
Module['run'] = Module.run = run;

function exit(status, implicit) {
  if (implicit && Module['noExitRuntime']) {
    return;
  }

  if (Module['noExitRuntime']) {
  } else {

    ABORT = true;
    EXITSTATUS = status;
    STACKTOP = initialStackTop;

    exitRuntime();

    if (Module['onExit']) Module['onExit'](status);
  }

  if (ENVIRONMENT_IS_NODE) {
    process['exit'](status);
  } else if (ENVIRONMENT_IS_SHELL && typeof quit === 'function') {
    quit(status);
  }
  // if we reach here, we must throw an exception to halt the current execution
  throw new ExitStatus(status);
}
Module['exit'] = Module.exit = exit;

var abortDecorators = [];

function abort(what) {
  if (what !== undefined) {
    Module.print(what);
    Module.printErr(what);
    what = JSON.stringify(what)
  } else {
    what = '';
  }

  ABORT = true;
  EXITSTATUS = 1;

  var extra = '\nIf this abort() is unexpected, build with -s ASSERTIONS=1 which can give more information.';

  var output = 'abort(' + what + ') at ' + stackTrace() + extra;
  if (abortDecorators) {
    abortDecorators.forEach(function(decorator) {
      output = decorator(output, what);
    });
  }
  throw output;
}
Module['abort'] = Module.abort = abort;

// {{PRE_RUN_ADDITIONS}}

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}

// shouldRunNow refers to calling main(), not run().
var shouldRunNow = true;
if (Module['noInitialRun']) {
  shouldRunNow = false;
}


run();

// {{POST_RUN_ADDITIONS}}






// {{MODULE_ADDITIONS}}



