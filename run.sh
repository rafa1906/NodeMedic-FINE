#!/bin/bash

# This script is used to analyze a package without the docker image
# It takes two arguments: the package name and the package version
# It will create a folder called output in the current directory
# and place the analysis artifacts in that folder

# Example usage: ./analyze_package_local.sh lodash 4.17.15 [additional flags for NodeMedic]

PACKAGE_NAME=$1
PACKAGE_VERSION=$2

echo "Analyzing package $PACKAGE_NAME@$PACKAGE_VERSION"

rm -rf ./output
rm -rf ./packages
rm -rf ./tmp

set -e
set -x

./pipeline/run_pipeline.sh 1 lower 0 --package=${PACKAGE_NAME}@${PACKAGE_VERSION} --fresh --start-index=0 --end-index=1 --min-num-deps=10 --min-depth=-1 --require-sink-hit --policies=object:precise,string:precise,array:precise --log-level=debug ${@:3}

set +x

echo "-"
echo "Analysis complete. Results are in ./output"
