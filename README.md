# NodeMedic-FINE

This is the repository for NodeMedic-FINE, an end-to-end dynamic provenance analysis 
tool for vulnerability discovery, triage, and confirmation in Node.js packages.

## Docker installation
Run the following command to build the docker container:

`docker build --platform=linux/amd64 -t nodemedic:latest .`

A fresh build takes around 3 minutes on an M1 MacBook Air.
After building, the newly created image should be visible:

```bash
$ docker image ls
REPOSITORY                          TAG               IMAGE ID       CREATED         SIZE
nodemedic                           latest            5124b389f2b2   8 seconds ago   2.43GB
```

### Note on ARM-based systems (e.g., Apple Silicon MacBooks)
While following the next instructions you may see this warning:
```
WARNING: The requested image's platform (linux/amd64) does not match the detected host platform (linux/arm64/v8) and no specific platform was requested
```
It can safely be ignored.

## Minimal working example
`docker run --rm -it nodemedic:latest --package=raspberry-vol --version=1.1.0 --mode=full`

The `--package` argument allows you to specify the package name to analyse. The `--version` argument is the specific version of the package to analyse

The `--mode` allows you to either download and analyse a package (`full`) or to just download the package and setup its dependencies (`gather`) or analyse an already gathered package (`analysis`). When gathering, you should mount a folder so that the container can write to some place visible to the host, like this:

In this case, no artifacts will be stored permanently on the system. In the next section, we describe how to run NodeMedic-FINE while storing its results and how to interpret them.

## Running NodeMedic-FINE 

Assuming the terminal is currently on the root folder of this project, the following command will download and install `raspberry-vol@1.1.0` and its dependencies on the chosen folder outside docker: 
`docker run -it --rm -v $PWD/packages/:/nodetaint/packageData:rw -v $PWD/artifacts/:/nodetaint/analysisArtifacts:rw nodemedic:latest --package=raspberry-vol --version=1.1.0 --mode=gather`

If you take a look at the `packages` folder you will see that `raspberry-vol@1.1.0` is installed there. In the `artifacts` folder, you will also find a `results_gather.json` file with information about which entrypoints the packages has among other metadata.

Still in the root folder, you can now tell NodeMedic-FINE to analyse the package:
`docker run -it --rm -v $PWD/packages/:/nodetaint/packageData:rw -v $PWD/artifacts/:/nodetaint/analysisArtifacts:rw nodemedic:latest --package=raspberry-vol --version=1.1.0 --mode=analysis`

You should see a line in the output saying `Checking generated exploit to confirm vulnerability`. This means that NodeMedic-FINE found a potential flow and tried to sythesize a proof-of-concept exploit to confirm it.

In this package, NodeMedic-FINE is able to successfully synthesize an exploit. You should therefore also see a line that looks like `Exploit(s) found for functions: prototype.runCommand` reporting that an exploit was found and stating the vulnerable entrypoint.

The `artifacts/` folder will now have the analysis results, including coverage files from the fuzzer, the provenance tree and synthesized exploits.

## Interpreting analysis results

Assuming an analysis run was performed and the user told NodeMedic-FINE to store them in the `artifacts` folder, you will find the following files there:
- `results.json`
  - Overall analysis results. To interpret this file, read the last section
- `fuzzer_progress.json`
  - Coverage information from the fuzzer, as a list of pairs (timestamp, coverage)
- `fuzzer_results.json`
  - General information from the fuzzer
- `run-<package_name>.js`
  - Driver that imports the package and the fuzzer and performs fuzzing
- `run-<package_name>2.js`
  - Second driver which only calls the vulnerable entrypoint with the appropriate input. This file will only exist if NodeMedic-FINE finds a potential flow
- `taint_0.json`
  - Provenance tree. There is also a .pdf version of it. These files will only exist if NodeMedic-FINE finds a potential flow
- `poc<argument_number>.js`
  - Automatically synthesized exploit, which imports the package and tries to exploit it. This file will only exist if NodeMedic-FINE finds a flow
 
### Pipeline output

The pipeline output follows the following structure. At the top level, it is a
list of "rows" where each row is an entry about a gathered and/or analyzed
package.

```json
{
    "rows": [
        <packageEntry>
    ]
}
```

The package entry has the following form:

```json
"id": package name,
"index": index in the npm package repo,
"version": package version,
"downloadCount": package download count,
"packagePath": package to installed package,
"hasMain": whether the package has a main script,
"browserAPIs": list of browser apis found in the package
"sinks": list of NodeMedic-supported sinks found in the package,
"sinksHit": list of sinks hit if `--require-sink-hit` flag is specified,
"entryPoints": list of package public APIs, e.g., [
    <entryPoint>
],
"treeMetadata": metadata about the packages dependency tree (size, depth, etc.),
"sinkType": type of sink (broadly split into ACI, exec, and ACE, eval),
"triageData": triage data about the package, including the computed rating,
"candidateExploit": candidate exploit synthesized for the package,
"exploitResults": results of executing candidate exploit,
"taskResults": object with status and runtime for every task run, e.g., {
    "task name": <taskResult>
}
```

The task results have the format:
```json
{ 
    "status": "Continue" meaning continue to next task | "Abort" meaning halt the pipeline, 
    "time": runtime in milliseconds,
    "result": error information, if any, indicating why the status is "Abort"
}
```

The list of possible tasks is:
- `downloadCount`: Queries the download count for a package.
- `setupPackage`: Downloads and unpacks package source code.
- `filterByMain`: Filters out packages that don't have a `main` script in their `package.json`.
- `filterByBrowserAPIs`: Filters out packages that contain browser APIs.
- `filterSinks`: Filters out packages that don't contain a NodeMedic-supported sink.
- `setupDependencies`: Downloads and sets up package dependencies.
- `getEntryPoints`: Imports the package to determine its public APIs.
- `runNonInstrumented`: Runs the package without instrumentation to check for inherent errors.
- `annotateNoInstrument`: Marks package dependencies for over-approximate analysis.
- `runJalangiBabel`: Runs package with blank Jalangi2 analysis to check runtime and inherent errors.
- `runInstrumented`: Runs the NodeMedic provenance analysis on the package.
- `triageFlow`: Runs the triage model on the generated provenance graph.
- `setSinkType`: Sets the type of the sink (command injection or code execution).
- `smt`: Runs exploit synthesis on the provenance graph generated during provenance analysis.
- `checkExploit`: Checks whether any synthesized candidate exploits were successful.
