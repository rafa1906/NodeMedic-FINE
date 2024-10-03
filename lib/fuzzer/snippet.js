const h = require('hasard');

const randomValue = h.value();
 
const randomInteger = h.integer({type: 'poisson', lambda: 4});
 
const randomString = h.string({
    size: randomInteger,
    value: h.value('abcdefghijklmnopkrstuvw'.split(''))
});

const randomNumber = h.number(-100, 100);
 
const randomObject = h.object({
    "a": randomValue,
    "b": randomValue,
    "c": randomValue}
);
 
randomValue.set({
    choices: [
        randomString,
        randomObject,
        randomNumber,
        randomInteger
    ]
});
 
console.log(randomObject.run(1000));