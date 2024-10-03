// JALANGI DRIVER
var PUT = require('ps');
var x = {};
__jalangi_set_taint__(x);
try {
	PUT.lookup({pid: x}, function(){});
} catch (e) {
	console.log(e);
}