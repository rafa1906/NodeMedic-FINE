// test4.js: taint propagated via conditionals

var x, y;

// Benign use
x = "1 + 1";
eval(x || "");

// Exploiting eval, not detected by our taint analysis
// Cannot be solved without changing the Jalangi implementation
x = "console.log('pwned');";
//__jalangi_set_taint__(x);  // Uncomment to run analysis, else input is not considered tainted
eval(x || "");


// Expected output:
// node test4.js: 
//     x = "1 + 1" -> 2
//     x = "console.log('pwned');" -> pwned [...]
// make analyze FILE=/nodetaint/example-analysis/test4.js:
//     x = "1 + 1" -> 2
//     x = "console.log('pwned');" -> Exception thrown when trying to eval (x || "" should be tainted)

// Actual output:
// node test4.js:
//     x = "1 + 1" -> 2
//     x = "console.log('pwned');" -> pwned [...]
// make analyze FILE=/nodetaint/example-analysis/test4.js:
//     x = "1 + 1" -> 2
//     x = "console.log('pwned');"-> pwned [...] (x || "" isn't tainted)


// Issue:
// Jalangi instruments `x || ""` (can be `if (x || "")`, `y = (x || "")`, `f(x || "")`, etc.) as follows:
//   var aret = analysis.conditional(iid, x);
//   if (aret) res = aret.result;
//   [...] res ? J$.last() : ""  // J$.last() is Jalangi function that returns last computed value (in this case, res)

// Implications:
// Jalangi doesn't have a callback for last(), so if we want to do anything to the result (e.g., taint
// propagation), we must do it to the intermediate value res 
//   - This is an issue because, for example, we might want to put the result in a proxy object, 
//     which can make a falsy value (e.g., false) truthy and change the control flow
//     - For instance, in the example above, if x (by extension, res) is falsy and we put res in a proxy,
//       then we change the control flow to choose J$.last(), when in reality it should choose ""  

// Ideally:
// Two possible solutions, either:
//   1. Add a callback for J$.last()
//   2. Change the instrumentation of conditional to something like:
//        var aret = analysis.conditional(iid, x);
//        if (aret) { cond = aret.cond; res = aret.result; }
//        [...] cond ? res : ""
//      So that cond can remain truthy/falsy and res can be operated upon (e.g., propagate taint, put in
//      proxy object, etc.)
