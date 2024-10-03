import { promises as fs } from 'fs';
import { Command } from 'commander';
import { Human, Filter } from 'caterpillar';
import {
    Path, Bound, readIndex,
    writePackageList, loadFilteredPackageList,
    getPackageListFromPath, getPackageListFromPackage, logger, delay,
    removePackageCache, setupDir, cleanJalangiFiles
} from './utilities';
import { Maybe } from './functional';
import { Context, Pipeline } from './pipeline';
import { buildPipeline } from './tasks';
import { PackageData } from './package';


async function runPipeline(
    targetCount: number,
    bound: Bound,
    downloadCount: number,
    fresh: boolean,
    cache: boolean,
    onlyCacheIncluded: boolean,
    cacheDir: Path,
    outputDir: Path,
    tmpDir: Path,
    packageListBounds: [Maybe<number>, Maybe<number>],
    mode: string,
    package_id: string,
    z3Path: Maybe<Path>,
    minNumDeps: Maybe<number>,
    minDepth: Maybe<number>,
    policies: Maybe<string>,
    requireSinkHit: boolean,
    failOnOutputError: boolean,
    failOnNonZeroExit: boolean,
    fuzzer_object_reconstruction: boolean,
    fuzz_strings_only: boolean,
    mix_fuzz: boolean,
    do_fuzzer_restarts: boolean,
    convertPotentialToString: boolean,
    baseline: boolean,
    honeyobjects: boolean,
    inference: boolean,
    enumerator: boolean,
    enumeratorTemplates: boolean,
    polyglotACIPayload: boolean,
    polyglotACEPayload: boolean,
    stringOnlySynthesis: boolean,
    solvingTime: number,
) {

    logger.info(`Gathering ${targetCount} packages with a ${bound} bound of ${downloadCount} downloads`);

    // Load existing package list
    var filteredPackageListPath: Path = outputDir.extend(['results.json']);
    if (mode == 'gather'){
        filteredPackageListPath = outputDir.extend(['results_gather.json']);
    }
    let filteredPackageList: Array<PackageData> = [];
    let startIndex = 0;
    if (!fresh) {
        startIndex = await readIndex(outputDir);
        logger.info('Loading existing filtered package list...')
        filteredPackageList = await loadFilteredPackageList(filteredPackageListPath);
        logger.info(`The existing list has ${filteredPackageList.length} packages`);
    } 
    logger.info('Overwriting existing filtered package list...');
    await writePackageList(filteredPackageList, filteredPackageListPath);

    // Get the npm package list
    logger.info('Getting package list...');

    logger.info(`Analysis only; analyzing package ${package_id}`);
    var packageList: Array<PackageData> = getPackageListFromPackage(package_id);

    // Override the start and index index, if provided via CLI
    if (!packageListBounds[0].isNothing()) {
        startIndex = packageListBounds[0].unwrap();
    }
    let endIndex = packageList.length;
    if (!packageListBounds[1].isNothing()) {
        endIndex = packageListBounds[1].unwrap();
        if (endIndex > packageList.length) {
            throw Error(`End index ${endIndex} is out-of-bounds for list length ${packageList.length}`);
        }
    }

    // Initialize the pipeline
    const pipeline: Pipeline = buildPipeline(logger);
    const initialContext = new Context({
        'logger': logger,
        'cacheDir': cacheDir,
        'outputDir': outputDir,
        'tmpDir': tmpDir,
        'bound': bound,
        'targetDownloadCount': downloadCount,
        'sinks': ['child_process', 'eval(', 'exec(', 'execSync(', 'new Function(', 'spawn(', 'spawnSync(', 'execFile(', 'execFileSync(', 'runInNewContext(', 'runInContext(', 'runInThisContext('],
        'browserAPIs': ['window.', 'document.'],
        'z3Path': z3Path,
        'minNumDeps': minNumDeps.orDefault(-1),
        'minDepth': minDepth.orDefault(0),
        'policies': policies.orDefault(''),
        'requireSinkHit': requireSinkHit,
        'failOnOutputError': failOnOutputError,
        'failOnNonZeroExit': failOnNonZeroExit,
        'fuzzer_object_reconstruction': fuzzer_object_reconstruction,
        'fuzzStringsOnly': fuzz_strings_only,
        'mixfuzz': mix_fuzz,
        'fuzzRestart': do_fuzzer_restarts,
        'convertPotentialToString': convertPotentialToString,
        'baseline': baseline,
        'honeyobjects': honeyobjects,
        'inference': inference,
        'enumerator': enumerator,
        'enumeratorTemplates': enumeratorTemplates,
        'polyglotACIPayload': polyglotACIPayload,
        'polyglotACEPayload': polyglotACEPayload,
        'stringOnlySynthesis': stringOnlySynthesis,
        'solvingTime': solvingTime,
    });

    // Set the task list
    let taskList: Array<string> = undefined; // Run all tasks in full mode
    if (mode === 'gather') {
        taskList = ['downloadCount', 'setupPackage', 'filterByMain',
            'filterBrowserAPIs', 'filterSinks', 'setupDependencies',
            'getEntryPoints', 'annotateNoInstrument', 'runJalangiBabel'];
    } else if (mode == 'analysis') {
        taskList = ['setupPackage', 'getEntryPoints', 'runNonInstrumented', 
            'runInstrumented', 'setSinkType', 'trivialExploit', 'checkExploit',
            'smt', 'checkExploit'];
    }
    else {
        taskList = ['downloadCount', 'setupPackage', 'filterByMain',
        'filterBrowserAPIs', 'filterSinks', 'setupDependencies',
        'getEntryPoints', 'annotateNoInstrument', 'runJalangiBabel', 'runNonInstrumented', 
        'runInstrumented', 'setSinkType', 'trivialExploit', 'checkExploit',
        'smt', 'checkExploit']
    }

    // Begin gathering
    logger.info(`Gathering from package list index ${startIndex} to ${endIndex - 1}`);
    for (let i = startIndex; i < endIndex; i++) {
        const thePackage = packageList[i];
        thePackage.setIndex(i);

        logger.info(`Testing package at index ${i}: ${thePackage.identifier()}`);

        initialContext.setProperty('thePackage', thePackage);
        await pipeline.execute(initialContext, taskList);

        // Record package data
        let included = true;
        if (mode == 'gather') {
            // For gathering, we require the package to have passed getEntryPoints
            included = pipeline.completedTask('getEntryPoints');
        }
        let reason: string;
        try {
            reason = `Pipeline stopped at ${pipeline.lastCompleted()}`;
        } catch (err) {
            reason = `Pipeline did not complete any tasks`;
        }
        if (included) {
            filteredPackageList.push(thePackage);
            writePackageList(filteredPackageList, filteredPackageListPath);
            logger.debug(`Included package: ${reason}`);
        } else {
            // If we encounter an error, don't include the package
            logger.debug(`Discarded package: ${reason}`);
        }

        // Potentially remove the package cache
        if (!cache || (onlyCacheIncluded && !included)) {
            logger.info('Removing package cache');
            await removePackageCache(thePackage);
        }
        // Clean up analysis files
        await cleanJalangiFiles(thePackage);

        if (filteredPackageList.length >= targetCount) {
            logger.debug(`Target count of ${targetCount} packages has been met`);
            break;
        }

        logger.info(`Filtered package list has ${filteredPackageList.length} packages`);

        // Rate-limiting
        await delay(500);
    }
    logger.info(`List has ${filteredPackageList.length} packages`);
}


async function main() {
    // Set up command line options
    const program = new Command();
    program
        .version('0.1.0')
        .command('pipeline <targetCount> <bound> <downloadCount>')
        .option('-f, --fresh', 'restart from package list index 0 and clear results')
        .option('-l, --log-level <level>', 'set the log level [debug | info | warn | error]')
        .option('-n, --no-cache', 'no package installation cache')
        .option('-c, --cache-dir <path>', 'path to the package cache directory')
        .option('-o, --output-dir <path>', 'path to store package list output')
        .option('-t, --tmp-dir <path>', 'path to store temporary files')
        .option('-s, --start-index <int>', 'package list index to start gathering from (overrides checkpoint)')
        .option('-e, --end-index <int>', 'maximum package list index to gather from')
        .option('-m, --mode <string>', '"gather", "analysis" or "full"')
        .option('-a, --package <string>', 'analyze the selected package name@version')
        .option('-z, --z3-path <path>', 'path to the Z3 solver binary')
        .option('--only-cache-included', 'only cache packages that pass the gathering filters')
        .option('--min-num-deps <int>', 'minimum number of deps for no-instrument heuristic')
        .option('--min-depth <int>', 'minimum depth to apply no-instrument header')
        .option('--policies <string>', 'taint policies to set')
        .option('--require-sink-hit', 'require that a sink was hit as a pipeline step')
        .option('--fail-on-output-error', 'fail a step if the process output has an error')
        .option('--fail-on-non-zero-exit', 'fail a step if the process exits with a non-zero exit code')
        .option('--baseline', 'Use baseline driver instead of fuzzer')
        .option('--disableFuzzerObjectReconstruction', 'Disable object reconstruction during fuzzing')
        .option('--fuzzStringsOnly', 'Only generate strings during fuzzing')
        .option('--mixfuzz', 'During fuzzing, try to generate strings only for some time, then fuzz all types without obj reconstruction for more, finally enable object reconstruction')
        .option('--doFuzzerRestarts', 'Restarts the fuzzer trice during analysis')
        .option('--convertPotentialToString', 'Tries to convert the payload to string when confirming first, as those cases are generally easier to reason about')
        .option('--honeyobjects', 'Enables honeyobjects in analysis and exploit synthesis')
        .option('--no-inference', 'Disables inference for exploit synthesis')
        .option('--no-enumerator', 'Disables enumerator for exploit synthesis')
        .option('--no-enumerator-templates', 'Disables enumerator templates for exploit synthesis')
        .option('--use-polyglot-aci-payload', 'Use polyglot ACI payload for exploit synthesis')
        .option('--use-polyglot-ace-payload', 'Use polyglot ACE payload for exploit synthesis')
        .option('--string-only-synthesis', 'Only consider strings in exploit synthesis, matching NodeMedic')
        .option('--solving-time <int>', 'Set the solving time for the SMT solver in seconds')
        .action(async function (
            targetCountStr: string,
            boundStr: string,
            downloadCountStr: string,
            options?: any
        ) {
            // Default log level is info
            let logLevel = logger.levels.info;
            let logLevelStr = options.logLevel;
            if (options.logLevel !== undefined) {
                switch (options.logLevel) {
                    case 'info':
                        logLevel = logger.levels.info;
                        break;
                    case 'debug':
                        logLevel = logger.levels.debug;
                        break;
                    case 'error':
                        logLevel = logger.levels.error;
                        break;
                    default:
                        throw Error(`Unsupported log level: ${logLevelStr}`);
                }
            } else {
                logLevelStr = 'info';
            }
            // Set up logger
            logger
                .pipe(new Filter({ filterLevel: logLevel })) // 6 -> info
                .pipe(new Human())
                .pipe(process.stdout);
            logger.debug(`The log level is set to ${logLevelStr}`);
            logger.debug('The raw options were:')
            logger.debug(options);
            // Package list start and end index
            let packageListBounds: [Maybe<number>, Maybe<number>] = [new Maybe(), new Maybe()];
            if (options.startIndex !== undefined) {
                packageListBounds[0] = new Maybe(Number.parseInt(options.startIndex));
            }
            if (options.endIndex !== undefined) {
                packageListBounds[1] = new Maybe(Number.parseInt(options.endIndex));
            }
            let bound = Bound.lower;
            if (boundStr == 'upper') {
                bound = Bound.upper;
            }
            logger.debug(`The package list bound is "${bound}" with range: ${packageListBounds[0]}-${packageListBounds[1]}`);
            // Set up package directory
            let cacheDirStr = './packages';
            if (options.cacheDir !== undefined) {
                cacheDirStr = options.cacheDir;
            }
            const cacheDir: Path = await setupDir(cacheDirStr);
            logger.debug(`The cache directory is: ${cacheDir.toString()}`);
            // Set up output directory
            let outputDirStr = './output';
            if (options.outputDir !== undefined) {
                outputDirStr = options.outputDir;
            }
            const outputDir = await setupDir(outputDirStr);
            logger.debug(`The output directory is: ${outputDir.toString()}`);
            // Set up tmp directory
            let tmpDirStr = './tmp';
            if (options.tmpDir !== undefined) {
                tmpDirStr = options.tmpDir;
            }
            const tmpDir = await setupDir(tmpDirStr);
            logger.debug(`The tmp directory is: ${tmpDir.toString()}`);
            // Gathering or analysis-only options

            var package_id;
            if (options.package !== undefined) {
                package_id = options.package;
                if (!options.package.includes("@") || options.length < 3) {
                    throw Error('Provided package is not formatted correctly. Example: a-csv@2.0.0')
                }
            }
            else{
                throw Error('Must provide package to analyse');
            }

            let z3Path: Maybe<Path> = Maybe.Nothing();
            if (options.z3Path !== undefined) {
                z3Path = Maybe.Just(options.z3Path);
            }
            // Set up other flags
            let targetCount = 0;
            try {
                targetCount = Number.parseInt(targetCountStr);
            } catch (err) {
                throw Error(`Target count must be an integer:\b{err}`);
            }
            let downloadCount = 0;
            try {
                downloadCount = Number.parseInt(downloadCountStr);
            } catch (err) {
                throw Error(`Download count must be an integer:\b{err}`);
            }
            let fresh = false;
            if (options.fresh !== undefined) {
                fresh = true;
            }
            logger.debug(`Fresh flag is set to ${fresh}`);
            let cache = true;
            if (options.cache === false) {
                cache = false;
            }
            logger.debug(`Cache flag is set to ${cache}`);
            let mode = 'full';
            if (options.mode !== undefined){
                mode = options.mode;
            }
            logger.debug(`Mode is set to ${mode}`)
            let onlyCacheIncluded = false;
            if (options.onlyCacheIncluded !== undefined) {
                onlyCacheIncluded = true;
            }
            logger.debug(`Only-cache-included is set to ${onlyCacheIncluded}`);
            let minNumDeps: Maybe<number> = Maybe.Nothing();
            if (options.minNumDeps !== undefined) {
                minNumDeps = Maybe.Just(Number.parseInt(options.minNumDeps));
            }
            logger.debug(`Auto-no-instrument: min-num-deps is set to ${minNumDeps}`);
            let minDepth: Maybe<number> = Maybe.Nothing();
            if (options.minDepth !== undefined) {
                minDepth = Maybe.Just(Number.parseInt(options.minDepth));
            }
            logger.debug(`Auto-no-instrument: min-depth is set to ${minDepth}`);
            let policies: Maybe<string> = Maybe.Nothing();
            if (options.policies !== undefined) {
                policies = Maybe.Just(options.policies);
            }
            logger.debug(`Taint policies: ${policies}`);
            let requireSinkHit = false;
            if (options.requireSinkHit !== undefined) {
                requireSinkHit = true;
            }
            logger.debug(`Require sink hit?: ${requireSinkHit}`);
            let failOnOutputError = false;
            if (options.failOnOutputError !== undefined) {
                failOnOutputError = true;
            }
            logger.debug(`Fail on output error?: ${failOnOutputError}`);
            let failOnNonZeroExit = false;
            if (options.failOnNonZeroExit !== undefined) {
                failOnNonZeroExit = true;
            }
            logger.debug(`Fail on non-zero exit?: ${failOnNonZeroExit}`);
            let baseline = false;
            if (options.baseline !== undefined) {
                baseline = true;
            }
            logger.debug(`Use baseline instead of fuzzer?: ${baseline}`);
            let fuzzerObjectReconstruction = true;
            if (options.disableFuzzerObjectReconstruction !== undefined){
                fuzzerObjectReconstruction = false;
            }
            logger.debug(`Use object reconstruction during fuzzing?: ${fuzzerObjectReconstruction}`);       
            let fuzz_strings_only = false;
            if (options.fuzzStringsOnly !== undefined){
                fuzz_strings_only = true;
            }     
            logger.debug(`Use only strings when fuzzing?: ${fuzz_strings_only}`); 
            let mixfuzz = false;
            if (options.mixfuzz !== undefined){
                mixfuzz = true;
            }
            logger.debug(`Use mix fuzzing?: ${mixfuzz}`);
            let do_fuzzer_restarts = false;
            if (options.doFuzzerRestarts !== undefined){
                do_fuzzer_restarts = true;
            }
            logger.debug(`Restart fuzzer 3 times during analysis: ${do_fuzzer_restarts}`);
            let convertPotentialToString = false;
            if (options.convertPotentialToString !== undefined){
                convertPotentialToString = true;
            }
            logger.debug(`Convert potential to string first: ${convertPotentialToString}`);
            let honeyobjects = false;
            if (options.honeyobjects !== undefined) {
                honeyobjects = true;
            }
            logger.debug(`Use honeyobjects?: ${honeyobjects}`);
            let inference = true;
            if (options.inference === false) {
                inference = false;
            }
            logger.debug(`Use inference for exploit synthesis?: ${inference}`);
            let enumerator = true;
            if (options.enumerator === false) {
                enumerator = false;
            }
            logger.debug(`Use enumerator for exploit synthesis?: ${enumerator}`);
            let enumeratorTemplates = true;
            if (options.enumeratorTemplates === false) {
                enumeratorTemplates = false;
            }
            logger.debug(`Use enumerator templates for exploit synthesis?: ${enumeratorTemplates}`);
            let polyglotACIPayload = false;
            if (options.usePolyglotAciPayload === true) {
                polyglotACIPayload = true;
            }
            logger.debug(`Use polyglot ACI payload for exploit synthesis?: ${polyglotACIPayload}`);
            let polyglotACEPayload = false;
            if (options.usePolyglotAcePayload === true) {
                polyglotACEPayload = true;
            }
            logger.debug(`Use polyglot ACE payload for exploit synthesis?: ${polyglotACEPayload}`);
            let stringOnlySynthesis = false;
            if (options.stringOnlySynthesis === true) {
                stringOnlySynthesis = true;
            }
            logger.debug(`Only consider strings in exploit synthesis?: ${stringOnlySynthesis}`);
            let solvingTime = 10;
            if (options.solvingTime !== undefined) {
                solvingTime = Number.parseInt(options.solvingTime);
            }
            logger.debug(`Solving time for SMT solver (seconds): ${solvingTime}`);
            // Global error handler
            process.on(
                'uncaughtException',
                (err) => logger.error(`Uncaught error: ${err.message}`)
            );
            process.on(
                'unhandledRejection',
                (reason) => logger.error(`Unhandled promise rejection: ${reason}`)
            )
            // Start the pipeline
            await runPipeline(
                targetCount,
                bound,
                downloadCount,
                fresh,
                cache,
                onlyCacheIncluded,
                cacheDir,
                outputDir,
                tmpDir,
                packageListBounds,
                mode,
                package_id,
                z3Path,
                minNumDeps,
                minDepth,
                policies,
                requireSinkHit,
                failOnOutputError,
                failOnNonZeroExit,
                fuzzerObjectReconstruction,
                fuzz_strings_only,
                mixfuzz,
                do_fuzzer_restarts,
                convertPotentialToString,
                baseline,
                honeyobjects,
                inference,
                enumerator,
                enumeratorTemplates,
                polyglotACIPayload,
                polyglotACEPayload,
                stringOnlySynthesis,
                solvingTime,
            )
            logger.info('Done with analysis');
        });
    program.parse(process.argv);
}

main();
