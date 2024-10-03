// JALANGI DRIVER
var PUT = require('pidusage');
var x = {};
__jalangi_set_taint__(x);
try {
	PUT.stat(x,x);
} catch (e) {
	console.log(e);
}