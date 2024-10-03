#!/bin/bash

# Argument specification
SHORT=p:,v:,m:,V::,f:,h
LONG=package:,version:,mode:,verdaccio::,flags:,help
OPTS=$(getopt -a -n NodeExploit --options $SHORT --longoptions $LONG -- "$@")
eval set -- "$OPTS"

# Default arguments
mode=full;
verdaccio=false;
flags="";

# Parse arguments
while :
do
  case "$1" in
    -p | --package )
      package="$2"
      shift 2
      ;;
    -v | --version )
      version="$2"
      shift 2
      ;;
    -m | --mode )
      mode="$2"
      shift 2
      ;;
    -f | --flags )
      flags="$2"
      shift 2
      ;;
    -V | --verdaccio )
      verdaccio=true;
      shift 2
      ;;
    -h | --help)
      echo "Example usage: docker run -it --rm --package=<package_name> --version=<version_name> --mode=<mode> --verdaccio --flags=<other_flags>"
      echo "--mode is optional (default is full) and takes values [gather, analysis, full]"
      echo "--verdaccio is optional (default is False). When True, it uses verdaccio instead of the NPM registry"
      echo "Value of --flags will be passed to our infra as flags"
      exit 2
      ;;
    --)
      shift;
      break
      ;;
    *)
      echo "Unexpected option: $1"
      ;;
  esac
done

if "$verdaccio" ; then
    npm set registry http://10.200.0.1:4873/
fi

# Debug arguments
#echo "Package name: $package";
#echo "Package version: $version";
#echo "Analysis mode: $mode";
#echo "Flags: $flags";
#echo "Using verdaccio: $verdaccio";

timeout 1800 /bin/sh -c "pipeline/run_pipeline.sh 1 lower 0 --mode=$mode --log-level=debug --cache-dir=packageData --output-dir=analysisArtifacts --tmp-dir=/tmp/ --z3-path=/nodetaint/z3/bin/z3 --fresh --package=$package@$version --start-index=0 --end-index=1 --min-num-deps=10 --min-depth=-1 --require-sink-hit --policies=object:precise,string:precise,array:precise $flags"

if [ "$mode" = "gather" ] ; then
  cat analysisArtifacts/results_gather.json;
else
  cat analysisArtifacts/results.json;
fi
