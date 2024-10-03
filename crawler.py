#!python3
import json
from sys import argv
from time import sleep
from pathlib import Path
from shutil import rmtree
from subprocess import run, Popen, STDOUT


class Logger(object):
    def __init__(self, levels):
        self._levels = levels

    def _display(self, msg, level):
        if level in self._levels:
            print(f'{level.upper()}: {msg}')

    def debug(self, msg):
        self._display(msg, 'debug')
    
    def info(self, msg):
        self._display(msg, 'info')

    def warn(self, msg):
        self._display(msg, 'warn')
    
    def error(self, msg):
        self._display(msg, 'error')


class Args(object):
    def __init__(self, sys_args=None, common_required=[], common_optional=[]):
        self._args = {}
        self._common_required = common_required
        self._common_optional = common_optional
        if sys_args is not None:
            self.load(sys_args)

    def load(self, sys_args):
        for token in sys_args:
            assert token.startswith('-')
            if '=' in token:
                parts = token.split('=')
                self._args[parts[0].strip('-')] = parts[1]
            else:
                self._args[token.strip('-')] = None
        return self._args

    def validate(self, required=[], optional=[]):
        for arg in required + self._common_required:
            assert arg in self._args, f'Arg -{arg} not provided'
        for arg in self._args:
            assert arg in required or arg in optional or arg in self._common_optional, \
                f'Unexpected arg -{arg} provided'

    def has(self, key):
        return key in self._args

    def get(self, key, default=None, fn=lambda x: x):
        if key in self._args:
            return fn(self._args[key])
        return default

    def __repr__(self):
        return f'{self._args}'


class State(object):
    def __init__(self, state_str=None):
        self._state = {}
        if state_str is not None:
            self.deserialize(state_str)

    def containers(self):
        return list(self._state.keys())
    
    def tag_of(self, container_name):
        return self._state[container_name]['tag']

    def id_of(self, container_name):
        return self._state[container_name]['id']
    
    def status_of(self, container_name):
        return self._state[container_name]['status']
    
    def packages_of(self, container_name):
        return self._state[container_name]['packages']
    
    def index_of(self, container_name):
        return self._state[container_name]['index']
    
    def config_of(self, container_name):
        return self._state[container_name]['config']
    
    def started(self, container_name, container_tag, container_id, config):
        self._state[container_name] = {
            'tag': container_tag,
            'id': container_id,
            'status': 'Running',
            'index': None,
            'packages': None,
            'config': config,
        }

    def running(self, container_name):
        self._state[container_name]['status'] = 'Running'
    
    def stopped(self, container_name):
        self._state[container_name]['status'] = 'Stopped'

    def done(self, container_name):
        self._state[container_name]['status'] = 'Done'

    def at_index(self, container_name, index):
        self._state[container_name]['index'] = index

    def num_packages(self, container_name, num):
        self._state[container_name]['packages'] = num

    def is_running(self, container_name):
        if container_name in self._state:
            return self._state[container_name]['status'] == 'Running'
        return False
    
    def is_done(self, container_name):
        if container_name in self._state:
            return self._state[container_name]['status'] == 'Done'
        return False

    def is_stopped(self, container_name):
        if container_name in self._state:
            return self._state[container_name]['status'] == 'Stopped'
        return False

    def serialize(self):
        return json.dumps(self._state, indent=4)
    
    def deserialize(self, state_str):
        self._state = json.loads(state_str)

    def __repr__(self):
        out = f'{"Container":<45}{"Status":<10}{"Packages":<10}{"Index":<10}\n'
        for container_name in self.containers():
            status = self.status_of(container_name)
            packages = self.packages_of(container_name)
            if packages is None:
                packages = '-'
            index = self.index_of(container_name)
            if index is None:
                index = '-'
            out += f'{container_name:<45}{status:<10}{packages:<10}{index:<10}\n'
        return out


def name_container(image, tag, cid):
    if tag == '':
        return f"{image.replace('/', '-').replace(':', '-')}-{cid}"  
    return f"{image.replace('/', '-').replace(':', '-')}-{tag}-{cid}"


def name_file(tag, cid):
    if tag == '':
        return f'{cid}'
    return f'{tag}_{cid}'


def exec_container(
    logger: Logger,
    base_dir: Path,
    image,
    tag='',
    cid=0,
    count=0,
    bound='lower',
    downloads=0,
    volume=None,
    log_level=None,
    z3_path=None,
    cache_dir=None,
    output_dir=None,
    tmp_dir=None,
    fresh=False,
    interactive=False,
    cleanup=False,
    start_index=None,
    end_index=None,
    only_cache_included=False,
    analysis_only=None,
    min_num_deps=None,
    min_depth=None,
    policies=None,
    require_sink_hit=False,
    fail_on_output_error=False,
    fail_on_non_zero_exit=False,
    dry_run=False,
):
    # Base command
    cmd = ['docker', 'run']
    # Docker flags
    docker_flags = []
    # Container name
    container_name = name_container(image, tag, cid)
    docker_flags.extend(['--name', container_name])
    # Interactive?
    if interactive:
        docker_flags.append('-it')
    # Clean up?
    if cleanup:
        docker_flags.append('--rm')
    # Mount volume
    if volume is not None:
        docker_flags.extend(['-v', f'{volume}:/persist'])
    # Specify container image
    docker_flags.append(image)
    # Specify pipeline path
    docker_flags.append('/nodetaint/pipeline/run_pipeline.sh')
    # Done with docker flags
    cmd.extend(docker_flags)
    # Pipeline flags
    pipeline_flags = []
    # Target count
    pipeline_flags.append(count)
    # Bound
    pipeline_flags.append(bound)
    # Target download count
    pipeline_flags.append(downloads)
    # Log level
    if log_level is None:
        log_level = 'info'
    pipeline_flags.append(f'--log-level={log_level}')
    # Cache dir
    if cache_dir is None:
        cache_dir = '/persist/cache'
    pipeline_flags.append(f'--cache-dir={cache_dir}')
    # Output dir
    if output_dir is None:
        output_dir = f'/persist/{name_file(tag, cid)}_output'
    pipeline_flags.append(f'--output-dir={output_dir}')
    # Tmp dir
    if tmp_dir is None:
        tmp_dir = f'/persist/{name_file(tag, cid)}_tmp'
    pipeline_flags.append(f'--tmp-dir={tmp_dir}')
    # Z3 Path
    if z3_path is None:
        z3_path = '/nodetaint/z3/bin/z3'
    pipeline_flags.append(f'--z3-path={z3_path}')
    # Fresh flag
    if fresh:
        pipeline_flags.append('--fresh')
    # Start index
    if start_index is not None:
        pipeline_flags.append(f'--start-index={start_index}')
    # End index
    if end_index is not None:
        pipeline_flags.append(f'--end-index={end_index}')
    # Only cache packages that pass gathering filters?
    if only_cache_included:
        pipeline_flags.append('--only-cache-included')
    # Only analyze files from the given list
    if analysis_only:
        pipeline_flags.append(f'--analysis-only={analysis_only}')
    # Set min num deps for auto-no-instrument
    if min_num_deps is not None:
        pipeline_flags.append(f'--min-num-deps={min_num_deps}')
    # Set min depth for auto-no-instrument
    if min_depth is not None:
        pipeline_flags.append(f'--min-depth={min_depth}')
    # Set taint policies
    if policies is not None:
        pipeline_flags.append(f'--policies={policies}')
    # Require sink hit?
    if require_sink_hit:
        pipeline_flags.append(f'--require-sink-hit')
    # Fail on output error?
    if fail_on_output_error:
        pipeline_flags.append(f'--fail-on-output-error')
    # Fail on non-zero exit?
    if fail_on_non_zero_exit:
        pipeline_flags.append(f'--fail-on-non-zero-exit')
    # Complete command construction
    cmd.extend(pipeline_flags)
    # Read out the cmd
    cmd = [str(x) for x in cmd]
    logger.debug(f'Executing: {" ".join(cmd)}')
    if not dry_run:
        log_path = base_dir / 'crawl_logs'
        if not log_path.exists():
            log_path.mkdir()
        with open(log_path / f'{name_file(tag, cid)}_container.log', 'w') as log_f:
            Popen(cmd, stdout=log_f, stderr=STDOUT)


def exec_ps(
    logger: Logger,
    flags=[],
    dry_run=False,
):
    # Get the docker container ps output
    cmd = ['docker', 'container', 'ps']
    cmd.extend(flags)
    logger.debug(f'Executing: {" ".join(cmd)}')
    ps_out = []
    if not dry_run:
        proc = run(cmd, capture_output=True)
        ps_out = proc.stdout.decode('utf-8')
        ps_out = [x for x in ps_out.split('\n') if x != '']
    return ps_out


def sync_container(
    logger: Logger,
    state: State,
    base_dir: Path,
    container_name,
    dry_run=False,
):
    tag = state.tag_of(container_name)
    cid = state.id_of(container_name)
    cmd = [
        'docker',
        'cp',
        f'{container_name}:/persist/{name_file(tag, cid)}_output',
        str(base_dir)
    ]
    logger.debug(f'Executing: {" ".join(cmd)}')
    if not dry_run:
        proc = run(cmd, capture_output=True)
        stdout = proc.stdout.decode('utf-8')
        stderr = proc.stderr.decode('utf-8')
        logger.debug(f'stdout: {stdout}')
        logger.debug(f'stderr: {stderr}')


def remove_container(
    logger: Logger,
    container_name,
    dry_run=False,
):
    cmd = [
        'docker',
        'rm',
        container_name
    ]
    logger.debug(f'Executing: {" ".join(cmd)}')
    if not dry_run:
        proc = run(cmd, capture_output=True)
        stdout = proc.stdout.decode('utf-8')
        stderr = proc.stderr.decode('utf-8')
        logger.debug(f'stdout: {stdout}')
        logger.debug(f'stderr: {stderr}')


def stop_container(
    logger: Logger,
    container_name,
    remove=False,
    dry_run=False,
):
    cmd = [
        'docker',
        'stop',
        container_name
    ]
    logger.debug(f'Executing: {" ".join(cmd)}')
    if not dry_run:
        proc = run(cmd, capture_output=True)
        stdout = proc.stdout.decode('utf-8')
        stderr = proc.stderr.decode('utf-8')
        logger.debug(f'stdout: {stdout}')
        logger.debug(f'stderr: {stderr}')
    if remove:
        remove_container(logger, container_name, dry_run)


def start_containers(
    logger: Logger,
    state: State,
    base_dir: Path,
    image,
    volume,
    num_containers,
    count,
    tag='',
    list_range=1e6,
    force=False,
    fresh=False,
    only_cache_included=False,
    analysis_only=None,
    min_num_deps=None,
    min_depth=None,
    policies=None,
    require_sink_hit=False,
    fail_on_output_error=False,
    fail_on_non_zero_exit=False,
    dry_run=False,
):
    step = int(list_range // num_containers)
    remainder = list_range - (step * num_containers)
    for i in range(num_containers):
        cid = i + 1
        container_name = name_container(image, tag, cid)
        # Don't start a container that has recorded data
        if container_name in state.containers() and not force:
            logger.info(f'Container {container_name} was already started')
            continue
        config = {
            'image': image,
            'volume': volume,
            'count': count,
            'start-index': i * step,
            'end-index': (i + 1) * step + (remainder if (i + 1) == num_containers else 0),
            'only-cache-included': only_cache_included,
            'analysis-only': analysis_only,
            'min-num-deps': min_num_deps,
            'min-depth': min_depth,
            'policies': policies,
            'require-sink-hit': require_sink_hit,
            'fail-on-output-error': fail_on_output_error,
            'fail-on-non-zero-exit': fail_on_non_zero_exit,
        }
        exec_container(
            logger,
            base_dir,
            config['image'],
            tag=tag,
            cid=cid,
            volume=config['volume'],
            count=config['count'],
            start_index=config['start-index'],
            end_index=config['end-index'],
            fresh=fresh,
            only_cache_included=config['only-cache-included'],
            analysis_only=config['analysis-only'],
            min_num_deps=config['min-num-deps'],
            min_depth=config['min-depth'],
            policies=config['policies'],
            require_sink_hit=config['require-sink-hit'],
            fail_on_output_error=config['fail-on-output-error'],
            fail_on_non_zero_exit=config['fail-on-non-zero-exit'],
            dry_run=dry_run,
        )
        state.started(container_name, tag, cid, config)
        logger.info(f'Started container {i + 1}: {container_name}')
    sleep(2)
    ps_out = exec_ps(logger, dry_run=dry_run)
    lines = 'Containers:\n' + '\n'.join(ps_out[1:])
    logger.debug(lines)


def resume_containers(
    logger: Logger,
    state: State,
    base_dir: Path,
    containers=None,
    remove=False,
    dry_run=False,
):
    if containers is None:
        logger.info(f'Resuming all stopped containers')
    else:
        logger.info(f'Resuming containers: {containers}')
    for container_name in state.containers():
        tag = state.tag_of(container_name)
        cid = state.id_of(container_name)
        if containers is not None and cid not in containers:
            continue
        config = state.config_of(container_name)
        if state.is_stopped(container_name):
            # Remove any existing stopped container
            if remove:
                stop_containers(logger, state, containers=[cid], remove=True, dry_run=dry_run)
            # Use last recorded index if possible, or
            # fall back to the config start index
            start_index = config['start-index']
            current_index = state.index_of(container_name)
            if current_index is not None and current_index != '':
                start_index = int(current_index) + 1
            exec_container(
                logger,
                base_dir,
                config['image'],
                tag=tag,
                cid=cid,
                volume=config['volume'],
                count=config['count'],
                start_index=start_index,
                end_index=config['end-index'],
                fresh=False,
                only_cache_included=config['only-cache-included'],
                analysis_only=config['analysis-only'],
                min_num_deps=config['min-num-deps'],
                min_depth=config['min-depth'],
                policies=config['policies'],
                require_sink_hit=config['require-sink-hit'],
                fail_on_output_error=config['fail-on-output-error'],
                fail_on_non_zero_exit=config['fail-on-non-zero-exit'],
                dry_run=dry_run,
            )
            state.running(container_name)
            logger.info(f'Resumed container: {container_name}')


def sync_containers(
    logger: Logger,
    state: State,
    base_dir,
    clean=False,
    dry_run=False,
):
    # Get the docker container ps output
    ps_out = exec_ps(
        logger,
        ['--format', '{{.Names}}'],
        dry_run=dry_run
    )
    crawl_logs_path = base_dir / 'crawl_logs'
    # Check each of the containers
    for container_name in state.containers():
        tag = state.tag_of(container_name)
        id = state.id_of(container_name)
        # Remove existing output if clean==True
        output_path = base_dir / f'{name_file(tag, id)}_output'
        if output_path.exists() and clean:
            logger.debug(f'Removing {name_file(tag, id)}_output')
            if not dry_run:
                rmtree(str(output_path))
        # Sync current container output
        sync_container(logger, state, base_dir, container_name)
        if output_path.exists():
            logger.debug('Output path exists')
            # Read the container's index
            with open(output_path / 'index.txt', 'r') as index_f:
                index = index_f.read()
                state.at_index(container_name, index)
            # Check the container's package list length
            sleep(5)
            with open(output_path / 'results.json', 'r') as results_f:
                try:
                    results_data = json.load(results_f)
                    list_len = len(results_data['rows'])
                    state.num_packages(container_name, list_len)
                except Exception as exn:
                    logger.error(f'Failed to check number of packages for container {container_name}:\n{exn}')
        # Check if the container is running
        if container_name in ps_out:
            state.running(container_name)
        else:
            state.stopped(container_name)
        # Check if the container is done
        crawl_log_path = crawl_logs_path / f'{name_file(tag, id)}_container.log'
        if crawl_log_path.exists():
            with open(crawl_log_path, 'r') as crawl_log_f:
                log_data = crawl_log_f.read()
                if 'Done with analysis' in log_data:
                    state.done(container_name)
        logger.info(f'Sync complete for {container_name}')


def stop_containers(
    logger: Logger,
    state: State,
    containers=None,
    remove=False,
    dry_run=False,
):
    if containers is None:
        logger.info(f'Stopping all containers')
    else:
        logger.info(f'Stopping containers: {containers}')
    for container_name in state.containers():
        cid = state.id_of(container_name)
        if containers is not None and cid not in containers:
            continue
        stop_container(logger, container_name, remove, dry_run)
        state.stopped(container_name)
        if remove:
            logger.info(f'Stopped and removed {container_name}')
        else:
            logger.info(f'Stopped {container_name}')


def watchdog(
    logger: Logger,
    state: State,
    base_dir: Path,
    state_path: Path,
    sleep_time=60, # minutes
    dry_run=False,
):
    logger.info('Starting watchdog')
    assert dry_run or len(state.containers()) > 0, 'State must be non-empty for watchdog'
    cycle_count = 0
    while True:
        logger.info('Syncing containers...')
        sync_containers(logger, state, base_dir, dry_run=dry_run)
        logger.info('Printing state...')
        print(state)
        logger.info('Backing up state...')
        if not dry_run:
            with open(str(state_path).replace('state.json', 'state.bak.json'), 'w') as state_f:
                state_f.write(state.serialize())
        logger.info('Resuming stopped containers...')
        resume_containers(logger, state, base_dir, remove=True, dry_run=dry_run)
        cycle_count += 1
        all_done = True
        for container in state.containers():
            if not state.is_done(container):
                all_done = False
        if all_done:
            logger.info(f'{cycle_count} cycles completed | Crawl is complete!')
            break
        else:
            logger.info(f'{cycle_count} cycles completed | Sleeping until next cycle ({sleep_time} min)')
            sleep(60 * sleep_time)


def main(sys_args):
    """
    Command: start
    Description: Start a crawl
    Required:
        -n=int: Number of containers
        --image=str: Image name
        --volume=str: Volume name
        --count=int: Target package count
        
    Optional:
        --tag: Tag for experiment file and folder names
        --fresh: Fresh flag set if specified
        --range=int: Last npm package list index to reach
        --force: Start container even if running
        --only-cache-included: Only cache packages that pass gathering filters
        --analysis-only=path: Only analyze packages from the given list
        --min-num-deps=number: Minimum number of dependencies for no-instrument heuristic
        --min-depth=number: Minimum depth to apply no-instrument header
        --policies=string: Taint policies to use (ex: --policies=string:precise,array:precise)
        --require-sink-hit: Require that a sink was hit as a pipeline step
        --fail-on-output-error: Fail a step if the process output has an error
        --fail-on-non-zero-exit: Fail a step if the process has a non-zero exit

    Command: resume
    Description: Resume an existing crawl
    Optional:
        --containers=int[]: Comma-separated container IDs to resume (default is all stopped)
        --rm: Remove stopped containers before resuming

    Command: sync
    Description: Sync crawl data from containers
    Optional:
        --clean: Remove existing synced output folders
    
    Command: stop       
    Description: Stop (and / or remove) all running crawl containers 
    Optional:
        --containers=int[]: Comma-separated container IDs to stop (default is all stopped)
        --rm: Remove the container

    Command: status
    Description: Display status of crawlers

    Command: clean
    Description: Remove existing state data

    Command: watchdog
    Description: Monitor a crawl and resume stopped containers
    Optional:
        --sleep-time: Time to sleep between watchdog cycles (minutes)

    Common flags:
    Optional:
        --log-level=str: Logging for the crawler (default is info)
        --base-dir=path: Base path to use for saving files (default is ./)
        --state=path: Path to save / load state JSON file (default is BASE/state.json)
        --dry-run: Print out commands without executing (use with --log-level=debug)
    """
    # Load the arguments
    assert len(sys_args) > 0, 'No args provided'
    cmd = sys_args[0]
    assert cmd in ['start', 'resume', 'sync', 'stop', 'status', 'clean', 'watchdog'], f'Unknown command: {cmd}'
    args = Args(sys_args[1:], common_optional=['base-dir', 'state', 'log-level', 'dry-run'])
    # Get and set up the base directory
    base_dir = args.get('base-dir', default=Path('./'), fn=lambda x: Path(x))
    if not base_dir.exists():
        base_dir.mkdir()
    # Initialize the state
    state = State()
    state_path = args.get('state', default=(base_dir / 'state.json'), fn=lambda x: Path(x))
    if state_path.exists():
        with open(state_path, 'r') as state_f:
            state_str = state_f.read()
            state.deserialize(state_str)
    # Initialize the logger
    log_level = args.get('log-level', default='info')
    if log_level == 'debug':
        levels = ['debug', 'info', 'warn', 'error']
    elif log_level == 'info':
        levels = ['info', 'warn', 'error']
    elif log_level == 'warn':
        levels = ['warn', 'error']
    elif log_level == 'error':
        levels = ['error']
    elif log_level == 'quiet':
        levels = []
    else:
        raise Exception(f'Unhandled log level: {log_level}')
    logger = Logger(levels)
    # Print the command and arguments
    logger.debug(f'Command: {cmd}\nArgs: {args}')
    # Dry run?
    dry_run = args.has('dry-run')
    # Delegate commands
    if cmd == 'start':
        args.validate(
            required=['n', 'image', 'count', 'volume'],
            optional=[
                'tag', 'range', 'fresh', 
                'force', 'only-cache-included', 'analysis-only', 
                'min-num-deps', 'min-depth', 'policies',
                'require-sink-hit', 'fail-on-output-error',
                'fail-on-non-zero-exit',
            ],
        )
        start_containers(
            logger,
            state,
            base_dir,
            args.get('image'),
            args.get('volume'),
            args.get('n', fn=lambda x: int(x)),
            args.get('count', fn=lambda x: int(x)),
            args.get('tag', default=''),
            args.get('range', default=1e6, fn=lambda x: int(x)),
            args.has('force'),
            args.has('fresh'),
            args.has('only-cache-included'),
            args.get('analysis-only'),
            args.get('min-num-deps'),
            args.get('min-depth'),
            args.get('policies'),
            args.has('require-sink-hit'),
            args.has('fail-on-output-error'),
            args.has('fail-on-non-zero-exit'),
            dry_run,
        )
    elif cmd == 'resume':
        args.validate(
            required=[],
            optional=['containers', 'rm']
        )
        containers = args.get(
            'containers',
            fn=lambda s: [int(x.strip()) for x in s.split(',') if x.strip() != '']
        )
        resume_containers(logger, state, base_dir, containers, dry_run)
    elif cmd == 'sync':
        args.validate(
            required=[],
            optional=['clean']
        )
        sync_containers(logger, state, base_dir, args.has('clean'), dry_run)
    elif cmd == 'stop':
        args.validate(
            required=[],
            optional=['containers', 'rm'],
        )
        containers = args.get(
            'containers', 
            fn=lambda s: [int(x.strip()) for x in s.split(',') if x.strip() != '']
        )
        stop_containers(logger, state, containers, args.has('rm'), dry_run)
    elif cmd == 'status':
        args.validate(
            required=[],
            optional=[],
        )
        print(state)
    elif cmd == 'clean':
        args.validate(
            required=[],
            optional=[],
        )
        if state_path.exists():
            logger.info(f'Removing existing state at {state_path}')
            if not dry_run:
                state_path.unlink()
                state = State()
    elif cmd == 'watchdog':
        args.validate(
            required=[],
            optional=['sleep-time'],
        )
        watchdog(
            logger,
            state,
            base_dir,
            state_path,
            sleep_time=args.get('sleep-time', default=60, fn=lambda x: int(x)),
            dry_run=dry_run
        )
    else:
        raise Exception(f'Unhandled command: {cmd}')
    # Save the final state
    if not dry_run:
        with open(state_path, 'w') as state_f:
            state_f.write(state.serialize())


if __name__ == '__main__':
    main(argv[1:])
