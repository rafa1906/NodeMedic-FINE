#!/bin/bash

echo "Setting up dependencies"

echo "Cloning jalangi2"
git clone https://github.com/Samsung/jalangi2.git

echo "Creating jalangi2-babel"
mkdir jalangi2-babel
cp -r jalangi2/src jalangi2-babel/
cp jalangi2/package.json jalangi2-babel/

echo "Applying jalangi2-babel patch"
cd jalangi2-babel
git apply ../babel-changes.patch
#patch jalangi2-babel/src/js/instrument/esnstrument.js < babel-changes.patch

echo "Installing npm dependencies"
npm i
npm i --save-dev @babel/core @babel/preset-env

echo "Installing fuzzer"
cd ../fuzzer
npm i
npm i .
for i in `find -name "*.js"`; do printf "\n// JALANGI DO NOT INSTRUMENT" >> $i; done

echo "Installing NodeExploitSynthesis"
cd ../NodeExploitSynthesis
npm i -D @types/node@latest
cd src/synthesis/operation_types && ./run.sh
pip3 install z3-solver==4.12.2
