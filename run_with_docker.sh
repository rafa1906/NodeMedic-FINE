#!/bin/bash

# This script is used to analyze a package with the docker image
# It takes two arguments: the package name and the package version
# It will create a folder called output in the current directory
# and place the analysis artifacts in that folder

# Example usage: ./run_package_with_docker.sh lodash 4.17.15 [additional flags for NodeMedic]

PACKAGE_NAME=$1
PACKAGE_VERSION=$2
IMAGE_NAME="nodemedic:070324"

echo "Analyzing package $PACKAGE_NAME@$PACKAGE_VERSION"

rm -rf ./output
rm -rf ./packages
mkdir -p ./output
mkdir -p ./packages

set -e
set -x

# docker run --rm -it -v ./output:/nodetaint/analysisArtifacts:rw -v ./packages:/nodetaint/packageData:rw $IMAGE_NAME --package=$PACKAGE_NAME --version=$PACKAGE_VERSION --flags="${@:3}"
docker run --rm -it $IMAGE_NAME --package=$PACKAGE_NAME --version=$PACKAGE_VERSION --flags="${@:3}"

set +x

echo "-"
echo "Analysis complete. Results are in ./output"
