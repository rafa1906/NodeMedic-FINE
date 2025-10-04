// test1.js: sanity check: function calls, branching, loops

function buildExpression(x) {
    // Build different arithmetic expressions as strings
    if (x % 2 === 0) {
        return `${x} * ${x}`; 
    } else {
        return `${x} + ${x}`;
    }
}

function wrapPayload(expr) {
    return { payload: expr };
}

function deliver(obj) {
    if (obj && obj.payload) {
        try {
            const result = eval(obj.payload);
            console.log(`Evaluating "${obj.payload}" =>`, result);
        } catch (e) {
            console.error("Eval failed:", e);
        }
    } else {
        console.log("Nothing to deliver");
    }
}

var x, y, z;

// Benign use
x = 1;
y = buildExpression(x);
z = wrapPayload(y);
deliver(z);

// Exploiting eval
x = "console.log('pwned');//";
//__jalangi_set_taint__(x);  // Uncomment to run analysis, else input is not considered tainted
y = buildExpression(x)
z = wrapPayload(y);
deliver(z);


// Expected output:
// node test1.js: 
//     x = 1 -> Evaluating "1 + 1" => 2
//     x = "console.log('pwned');//" -> pwned [...]
// make analyze FILE=/nodetaint/example-analysis/test1.js: 
//     x = 1 -> Evaluating "1 + 1" => 2
//     x = "console.log('pwned');//" -> Exception thrown when trying to eval (obj.payload should be/is tainted)
