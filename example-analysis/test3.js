// test3.js: taint propagated via for...in

var x;

// Benign use
var x = { "1 + 1": "" };
for (var p in x) var res = eval(p); console.log(res);

// Exploiting eval, not detected by our taint analysis
// Can be solved by "patching together" the reference to `x` with the references to `p` but this is
// ad hoc and this relation is not explicitly exposed by Jalangi (see below for details)
var x = { "console.log('pwned');": "" };
//__jalangi_set_taint__(x);  // Uncomment to run analysis, else input is not considered tainted
for (var p in x) var res = eval(p); console.log(res);


// Expected output:
// node test3.js: 
//     x = { "1 + 1": "" } -> 2
//     x = { "console.log('pwned');": "" } -> pwned [...]
// make analyze FILE=/nodetaint/example-analysis/test3.js: 
//     x = { "1 + 1": "" } -> 2
//     x = { "console.log('pwned');": "" } -> Exception thrown when trying to eval (p should be tainted)

// Actual output:
// node test3.js: 
//     x = { "1 + 1": "" } -> 2
//     x = { "console.log('pwned');": "" } -> pwned [...]
// make analyze FILE=/nodetaint/example-analysis/test3.js: 
//     x = { "1 + 1": "" } -> 2
//     x = { "console.log('pwned');": "" } -> pwned [...] (p isn't tainted)


// Issue:
// Jalangi instruments `for (p in obj)` as follows:
//   var aret = analysis.forinObject(iid, obj);
//   if (aret) obj = aret.result;
//   for (p in obj) { [...] }
// It doesn't expose a callback with access to p inside the loop (e.g., analysis.forinObjectPost(iid, obj, p))

// Implications:
// We don't have access to p in a way that makes the connection to obj/the for...in loop explicit
//   - This means that we cannot apply taint propagation policies to p based on obj (in our case, for
//    example, we would like to say that obj tainted -> p tainted)
//   - It's theoretically possible to "patch together" the accesses to p inside the loop, however:
//     - Very ad hoc, requires deep knowledge about the inner workings of Jalangi and how p is hooked 
//       into inside the loop (no explicit reference to the for...in loop AND obj), leading to having
//       to write very unintuitive/confusing taint propagation polices

// Ideally:
// Instrumentation adds a callback with access to p inside the loop:
//   var aret = analysis.forinObject(iid, obj);
//   if (aret) obj = aret.result;
//   for (p in obj) { 
//     var aret = analysis.forinObjectPost(iid, obj, p);
//     if (aret) { obj = aret.result; p = aret.p; }
//     [...]
//   }