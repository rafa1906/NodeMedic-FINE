x = new Set();
x.add("a");
x.add("b");
x.add("c");
x.add("c");

console.log(x);

y = "a";

var r1 = x.has(y);
console.log(r1, x);

var r2 = x.delete(y);
console.log(r2, x);

// Expected output:
// node test4.js:
//     x = Set(3) { 'a', 'b', 'c' }
//     r1, x = true, Set(3) { 'a', 'b', 'c' }
//     r2, x = true, Set(2) { 'b', 'c' }
// make analyze FILE=/nodetaint/example-analysis/test4.js:
//     x = Set(3) { [String: 'a'], [String: 'b'], [String: 'c'] }
//     r1, x = true, Set(3) { [String: 'a'], [String: 'b'], [String: 'c'] }
//     r2, x = true, Set(2) { [String: 'b'], [String: 'c'] }

// Actual output:
// node test4.js:
//     x = Set(3) { 'a', 'b', 'c' }
//     r1, x = true, Set(3) { 'a', 'b', 'c' }
//     r2, x = true, Set(2) { 'b', 'c' }
// make analyze FILE=/nodetaint/example-analysis/test4.js:
//     x = Set(4) { [String: 'a'], [String: 'b'], [String: 'c'], [String: 'c'] }
//     r1, x = false, Set(4) { [String: 'a'], [String: 'b'], [String: 'c'], [String: 'c'] }
//     r2, x = false, Set(4) { [String: 'a'], [String: 'b'], [String: 'c'], [String: 'c'] }


// Issue:
// x.add(), x.has() and x.delete() are native functions, so Jalangi only instruments the call
// sites via the callbacks:
//   - invokeFunPre: exposes the base x and arguments before execution.
//   - invokeFun: exposes the base x, arguments, and return value after execution.
// It doesn't track or model the internal behavior of the functions, so there is no explicit
// connection between inputs and outputs.

// Implications:
// Disconnect between analysis and actual JS execution: 
//   1. We don't know how native functions operate on the inputs unless we explicitly model it
//   2. The engine doesn't understand our internal model of sets (likewise, objects, arrays, maps,
//      etc.), namely, that primitives are wrapped and should be unwrapped when comparing them
//      (e.g., s1 = [String: 'a'] and s2 = [String: 'a'] are equal, even though the references differ)
// Case by case modelling is possible but requires exhaustive listing of all native functions we can/wish
// to support. In our case:
//
//   [Object]
//   - defineProperty: (partially) supported by explicit modelling
//   - assign: not supported in this version
//   - Other methods (e.g., keys, hasOwnProperty, etc.): generally supported, but more by coincidence than 
//     anything else (inner workings are opaque)
//
//   [String]
//   - blink: supported by explicit modelling
//   - substring: supported by explicit modelling
//   - concat: supported by explicit modelling 
//   - toUpperCase: supported by explicit modelling
//   - toLowerCase: supported by explicit modelling
//   - charCodeAt: supported by explicit modelling
//   - codePointAt: supported by explicit modelling
//   - split: supported by explicit modelling
//   - Other methods (e.g., slice, startsWith, etc.): generally supported via special string encoding
//     technique enconding information in the private use bits (cf. unicode private use areas)
//
//   [Array]
//   - map: supported by explicit modeling
//   - push: supported by explicit modeling
//   - join: supported by explicit modeling
//   - reduce: supported by explicit modeling
//   - reduceRight: supported by explicit modeling
//   - includes: not supported in this version
//   - indexOf: not supported in this version
//   - lastIndexOf: not supported in this version
//   - flatMap: not supported in this version
//   - filter: not supported in this version
//   - every: not supported in this version
//   - some: not supported in this version
//   - find: not supported in this version
//   - findIndex: not supported in this version
//   - findLast: not supported in this version
//   - findLastIndex: not supported in this version

// [Map]
//   - get: supported by explicit modeling
//   - set: supported by explicit modeling
//   - has: works out of the box because our Map model doesn't put keys in proxy objects
//   - delete: works out of the box because our Map model doesn't put keys in proxy objects

// [Set]
//   - add: not supported in this version
//   - has: not supported in this version
//   - delete: not supported in this version
//   - difference: not supported in this version (>ES5 feature)
//   - intersection: not supported in this version (>ES5 feature)
//   - isDisjointFrom: not supported in this version (>ES5 feature)
//   - isSubsetOf: not supported in this version (>ES5 feature)
//   - isSupersetOf: not supported in this version (>ES5 feature)
//   - symmetricDifference: not supported in this version (>ES5 feature)
//   - union: not supported in this version (>ES5 feature)

// Ideally:
// Instrumentation reflects (via callbacks) how the return value is obtained from the inputs AND if/how
// the base changes according to the standard. For example:
//   - (Set) x.has(y): returns true if set x has y (under SameValueZero equality), false otherwise; 
//     doesn't affect x
//   OR
//   - (Set) x.delete(y): returns true if set x has y, false otherwise; deletes y (if present) from x