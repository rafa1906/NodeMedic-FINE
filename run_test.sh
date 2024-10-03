#!/bin/bash

# Call this script with a directory containing a driver.js file
# Ex: ./run.sh tests/provenance_graph/test1

set -e

if [ -z "$1" ]; then
    echo "Missing path to a directory with driver.js";
    exit 1;
fi

if [[ -d "$1" ]]; then
    echo "$1 is a valid directory; continuing...";
else
    echo "Argument 1: '$1' is not a directory";
    exit 1;
fi

if [ -e "$1/driver.js" ]; then
    echo "Driver file exists; continuing...";
else
    echo "driver.js does not exist in $1";
    exit 1;
fi

echo "Cleaning analysis output"
rm taint*.json || echo "No taint.json";
rm taint*.pdf || echo "No taint.pdf";
rm analysis.out || echo "No analysis.out";
echo "Done"

echo "Analyzing $1"
(make analyze FILE=$1/driver.js TAINTPATHS=true TAINTPATHSJSON=true POLICIES=object:precise,string:precise,array:precise LOGLEVEL=warn ASSERTPASSED=false HONEYOBJECTS=true &> analysis.out) || true;
echo "Done"

echo "Moving analysis results"
sleep 1;
mv analysis.out $1
mv taint*.json $1 || echo "No taint.json";
mv taint*.pdf $1 || echo "No taint.pdf";
echo "Done"
