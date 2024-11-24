# NodeMedic-FINE

This is the repository for NodeMedic-FINE, an end-to-end dynamic provenance analysis 
tool for vulnerability discovery, triage, and confirmation in Node.js packages.

## Prerequisites
Running NodeMedic-FINE requires a system with at least 4 GB of RAM and 5 GB of 
storage (storage requirements will vary depending on the number of packages 
one analyzes). There is no specific CPU requirement, but the workload is
CPU-bound, so having a more powerful CPU will help. There is no GPU requirement.

NodeMedic-FINE has been tested on macOS and Linux, but any operating system 
(e.g., Windows) that can run Docker containers should be sufficient.


## Docker installation
Run the following command in the root of the project (in the same directory
as the `Dockerfile`) to build the Docker container:

```bash
docker build --platform=linux/amd64 -t nodemedic-fine:latest .
```

For reference, a fresh build takes around 3 minutes on a M1 Mac.
After building, the newly created image can be listed:

```bash
$ docker image ls
REPOSITORY      TAG     IMAGE ID       CREATED         SIZE
nodemedic-fine  latest  5124b389f2b2   8 seconds ago   2.43GB
```

#### Note on ARM-based systems (e.g., Apple Silicon MacBooks)
When running the Docker container you may see the following warning, which can
safely be ignored:
```
WARNING: The requested image's platform (linux/amd64) does not match the detected host platform (linux/arm64/v8) and no specific platform was requested
```
The warning is because the Docker container will be run using cross-architecture
emulation.

## Minimal working example
```bash
docker run --rm -it nodemedic-fine:latest --package=node-rsync --version=1.0.3 --mode=full
```
The `--package` argument allows you to specify the package name to analyze 
The `--version` argument is the specific version of that package to analyze.

The `--mode` allows you to either download and analyze a package (`full`) or to 
just download the package and setup its dependencies (`gather`) or analyze an 
already gathered package (`analysis`).

In this case, no artifacts will be stored permanently on the system. In the next 
section, we describe how to run NodeMedic-FINE while storing its results, 
and how to interpret them.

## Running NodeMedic-FINE 

Assuming the terminal is currently on the root directory of this project, the 
following command will download and install `node-rsync@1.0.3` and its 
dependencies in on the chosen directory outside docker:
```bash
docker run -it --rm -v $PWD/packages/:/nodetaint/packageData:rw -v $PWD/artifacts/:/nodetaint/analysisArtifacts:rw nodemedic-fine:latest --package=node-rsync --version=1.0.3 --mode=gather
```

If you take a look at the `packages` directory you will see that 
`node-rsync@1.0.3` is installed there. In the `artifacts` directory, you will 
also find a `results_gather.json` file with information about which entry points 
(exported functions) the packages has, among other metadata.

Still in the root directory, you can now tell NodeMedic-FINE to analyze the package:
```bash
docker run -it --rm -v $PWD/packages/:/nodetaint/packageData:rw -v $PWD/artifacts/:/nodetaint/analysisArtifacts:rw nodemedic-fine:latest --package=node-rsync --version=1.0.3 --mode=analysis
```

You should see a line in the output saying 
`Checking generated exploit to confirm vulnerability`. 
This means that NodeMedic-FINE found a potential flow and tried to synthesize 
a proof-of-concept exploit to confirm it.

In this package, NodeMedic-FINE is able to successfully synthesize an exploit. 
You should therefore also see a line that looks like 
`Exploit(s) found for functions:` reporting that an exploit 
was found and stating the vulnerable entry point.

The `artifacts/` directory will now have the analysis results, including 
coverage files from the fuzzer, the provenance tree, and synthesized exploits.

## Interpreting analysis results

Assuming an `analysis` run was performed, and the user told NodeMedic-FINE to 
store them in the `artifacts` directory, you will find the following files there:
- `results.json`
  - Overall analysis results. To interpret this file, read the last section.
- `fuzzer_progress.json`
  - Coverage information from the fuzzer, as a list of pairs (timestamp, coverage).
- `fuzzer_results.json`
  - General information from the fuzzer.
- `run-<package_name>.js`
  - Driver that imports the package and the fuzzer and performs fuzzing.
- `run-<package_name>2.js`
  - Second driver which only calls the potentially vulnerable entry point with 
    the fuzzer-generated input. This file will only exist if NodeMedic-FINE 
    finds a potential flow.
- `taint_0.json`
  - The provenance graph produced by NodeMedic-FINE. There is also a `.pdf` 
    visualization of it. These files will only exist if NodeMedic-FINE 
    finds a potential flow.
- `poc<argument_number>.js`
  - Automatically synthesized exploit driver, which imports the package and tries 
    to exploit it. This file will only exist if NodeMedic-FINE finds a flow.
 
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
"index": index in the npm package repo (gathering only),
"version": package version,
"downloadCount": package download count (gathering only),
"packagePath": path to installed package,
"hasMain": whether the package has a main script,
"browserAPIs": list of browser APIs found in the package,
"sinks": list of NodeMedic-supported sinks found in the package,
"sinksHit": list of sinks hit if `--require-sink-hit` flag is specified,
"entryPoints": list of package public APIs, e.g., [
    <entryPoint>
],
"treeMetadata": metadata about the package's dependency tree (size, depth, etc.),
"sinkType": type of sink (broadly split into ACI, exec, and ACE, eval),
"synthesisResult": synthesized package exploit input,
"candidateExploit": candidate exploit for the package,
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


## Repository Structure
The repository is organized as follows:
- `artifacts`: An empty directory where analysis artifacts are stored when running NodeMedic-FINE as shown above in the readme.
- `lib`: Contains components that NodeMedic-FINE uses to analyze packages:
    - `fuzzer`: Type- and structure-aware fuzzer that generates package API inputs.
    - `NodeExploitSynthesis`: Exploit synthesis engine that generates candidate exploits from provenance graphs.
- `packages`: An empty directory where npm packages to analyze are stored when running NodeMedic-FINE as shown above in the readme.
- `pipeline`: Contains the NodeMedic-FINE pipeline "orchestrator" that will handle downloading and installing packages to analyze, fuzzing them, running the NodeMedic provenance analysis, and then running automated exploit confirmation.
- `src`: Provenance analysis source code shared with the NodeMedic analysis.
- `tests`: Contains test files:
    - `case_studies`: A set of case studies applicable to the NodeMedic provenance analysis.
    - `unit_jalangi`: A set of unit tests that check the correctness of the NodeMedic provenance analysis.
