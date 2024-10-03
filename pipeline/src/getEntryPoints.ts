const PACKAGE_PATH = "";
const testPackage = require(PACKAGE_PATH);
const exec = require('child_process').exec;

function max(a, b){
    if (a > b){
        return a;
    }
    return b;
}

function getNumArgs(func) {
    var funcStr = func.toString();
    var commaCount = 0;
    var bracketCount = 0;
    var lastParen = 0;
    var inStrSingle = false;
    var inStrDouble = false;
    for (var i = 0; i < funcStr.length; i++) {
      if (['(', '[', '{'].includes(funcStr[i]) && !inStrSingle && !inStrDouble) {
        bracketCount++;
        lastParen = i;
      } else if ([')', ']', '}'].includes(funcStr[i]) && !inStrSingle && !inStrDouble) {
        bracketCount--;
        if (bracketCount < 1) {
          break;
        }
      } else if (funcStr[i] === "'" && !inStrDouble && funcStr[i - 1] !== '\\') {
        inStrSingle = !inStrSingle;
      } else if (funcStr[i] === '"' && !inStrSingle && funcStr[i - 1] !== '\\') {
        inStrDouble = !inStrDouble;
      } else if (funcStr[i] === ',' && bracketCount === 1 && !inStrSingle && !inStrDouble) {
        commaCount++;
      }
    }
  
    // Handle no arguments (last opening parenthesis to the last closing one is empty)
    if (commaCount === 0 && funcStr.substring(lastParen + 1, i).trim().length === 0) {
      return func.length;
    }
  
    return max(func.length, commaCount + 1);
  }

function getFunctionProperties(testPackage, fromConstructor, prefix) {
    let baseProperties = Object.getOwnPropertyNames(Object.prototype)
                          .concat(Object.getOwnPropertyNames(Function.prototype));

    if (testPackage === null || testPackage === undefined){
      return [];
    }
    
    return Object.getOwnPropertyNames(testPackage)
        .filter(function (propertyName) {
            try {
                return propertyName != 'constructor'
                    && typeof testPackage[propertyName] === 'function'
                    && (getNumArgs(testPackage[propertyName]) > 0 || testPackage[propertyName].toString().includes('...'))
                    && propertyName != ''
                    && !baseProperties.includes(propertyName);
            } catch (e) {
                return false;
            }
        })
        .map(function (functionName) {
            const hasRestParams = testPackage[functionName].toString().includes('...');
            const isExec = testPackage[functionName] === exec;
            return {
                functionName: prefix === undefined ? 
                                functionName
                                : prefix + '.' + functionName,
                numArguments: (hasRestParams || isExec) ? 1 : getNumArgs(testPackage[functionName]),
                isMethod: true,
                isConstructor: 'prototype' in testPackage[functionName],
                fromConstructor: fromConstructor,
            }
        });
}

// Enumerate all of the entry points (public functions) of the package
let entryPoints = [];
entryPoints.push(...getFunctionProperties(testPackage, false));
entryPoints.push(...getFunctionProperties(testPackage.__proto__, false));

// Traverse object properties recursively
let propertyQueue = [];
propertyQueue.push([testPackage, '']);
while (propertyQueue.length > 0) {
    const current = propertyQueue.pop();
    const currentObject = current[0];
    const currentPrefix = current[1];

    if (currentObject !== null && currentObject !== undefined){
      Object.getOwnPropertyNames(currentObject).forEach(function (propertyName) {
          let newName = currentPrefix == '' ?
              propertyName :
              currentPrefix + '.' + propertyName;
          if (typeof currentObject[propertyName] === 'object') {
              propertyQueue.push([currentObject[propertyName], newName]);
              entryPoints.push(...getFunctionProperties(
                  currentObject[propertyName], 
                  false, 
                  newName
              ));
          }
      });
    }
}

if (typeof testPackage === 'function') {
    const isConstructor = 'prototype' in testPackage;
    entryPoints.push({
        functionName: testPackage.name,
        numArguments: getNumArgs(testPackage),
        isMethod: false,
        isConstructor: isConstructor,
        fromConstructor: false,
    });
    if (isConstructor) {
        entryPoints.push(...getFunctionProperties(testPackage, true));
        entryPoints.push(...getFunctionProperties(testPackage.prototype, true));
    }
}

console.log('----- ENTRYPOINTS -----');
console.log(JSON.stringify(entryPoints));
console.log('-----------------------');
