// test2.js: taint propagated via Promise

var x;
var opts = "none";

// Benign use
x = "1 + 1";
Promise.resolve([x, opts]).then((input) => { var res = eval(input[0]); console.log(res); });

// Exploiting eval
x = "console.log('pwned');";
//__jalangi_set_taint__(x);  // Uncomment to run analysis, else input is not considered tainted
Promise.resolve([x, opts]).then((input) => { var res = eval(input[0]); console.log(res); });


// Expected output:
// node test1.js: 
//     x = "1 + 1" -> 2
//     x = "console.log('pwned');" -> pwned [...]
// make analyze FILE=/nodetaint/example-analysis/test1.js: 
//     x = 1 -> 2
//     x = "console.log('pwned');" -> Exception thrown when trying to eval (input[0] should be tainted)

// Actual output:
// node test1.js: 
//     x = "1 + 1" -> 2
//     x = "console.log('pwned');" -> pwned [...]
// make analyze FILE=/nodetaint/example-analysis/test1.js: 
//     x = 1 -> 2
//     x = "console.log('pwned');" -> pwned [...] (input[0] isn't tainted)


// Issue:
// Promise.resolve() is a native function, so Jalangi only instruments the call site via the callbacks:
//   - invokeFunPre: exposes the base Promise and arguments before execution.
//   - invokeFun: exposes the base Promise, arguments, and return value after execution.
// It does not track or model the internal behavior of Promise.resolve(), so there is no explicit
// connection between inputs and outputs.

// Implications:
// We don't know how Promise.resolve() operates on the inputs unless we explicitly model it:
//   - In simple cases, e.g., Promise.resolve(z), we can (and do) employ a lightweight model: 
//     z tainted -> return value tainted, z untainted -> return value untainted
//   - However, in general, accurate modeling is impractical or even impossible:
//     - When resolving arrays (as seen above) or objects.
//     - When resolving another Promise.
//     - When resolving an arbitrary thenable.

// Ideally:
// Instrumentation reflects (via callbacks) how the return value is obtained from the inputs according 
// to the standard. For example:
//   - Does Promise.resolve() just return the input as is? -> Single return callback (+ function enter/exit)
//   OR
//   - Are any operations performed on the input? -> Callbacks for performed operations