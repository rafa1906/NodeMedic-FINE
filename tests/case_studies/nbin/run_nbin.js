// JALANGI DRIVER
var PUT = require('nbin');
var x = {};
__jalangi_set_taint__(x);
try {
    PUT.exec(x,x);
} catch (e) {
	console.log(e);
}