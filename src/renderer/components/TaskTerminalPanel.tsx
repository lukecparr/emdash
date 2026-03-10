import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { TerminalPane } from './TerminalPane';
import { Bot, Plus, Play, Square, ChevronDown, ChevronRight } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useTaskTerminals } from '@/lib/taskTerminalsStore';
import { cn } from '@/lib/utils';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { Button } from './ui/button';
import type { Agent } from '../types';
import { getTaskEnvVars } from '@shared/task/envVars';
import { shouldDisablePlay } from '../lib/lifecycleUi';

interface Task {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
}

interface Props {
  task: Task | null;
  agent?: Agent;
  className?: string;
  projectPath?: string;
  remote?: {
    connectionId: string;
    projectPath?: string;
  };
  defaultBranch?: string;
  portSeed?: string;
}

type LifecyclePhaseStatus = 'idle' | 'running' | 'succeeded' | 'failed';
type LifecyclePhase = 'setup' | 'run' | 'teardown';
type LifecycleLogs = Record<LifecyclePhase, string[]>;

/** Which top-level tab is selected */
type TabId = 'setup' | 'run' | 'terminal';

const TaskTerminalPanelComponent: React.FC<Props> = ({
  task,
  agent,
  className,
  projectPath,
  remote,
  defaultBranch,
  portSeed,
}) => {
  const { effectiveTheme } = useTheme();

  // Use path in the key to differentiate multi-agent variants that share the same task.id
  const taskKey = task ? `${task.id}::${task.path}` : 'task-placeholder';
  const taskTerminals = useTaskTerminals(taskKey, task?.path);
  // Global terminals are scoped per variant (or project when no task) so each
  // agent worktree gets its own global terminal and simultaneous variants don't conflict.
  const globalKey = task?.path ? `global::${task.path}` : `global::${projectPath}`;
  const globalTerminals = useTaskTerminals(globalKey, projectPath, { defaultCwd: projectPath });

  const [activeTab, setActiveTab] = useState<TabId>('setup');
  const [collapsed, setCollapsed] = useState(false);

  // Track which terminal is active within the terminal tab
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  // Track whether the active terminal is from 'task' or 'global' scope
  const [terminalScope, setTerminalScope] = useState<'task' | 'global'>('task');

  const [runStatus, setRunStatus] = useState<LifecyclePhaseStatus>('idle');
  const [setupStatus, setSetupStatus] = useState<LifecyclePhaseStatus>('idle');
  const [_teardownStatus, setTeardownStatus] = useState<LifecyclePhaseStatus>('idle');
  const [runActionBusy, setRunActionBusy] = useState(false);
  const activeTaskIdRef = useRef<string | null>(task?.id ?? null);
  const [lifecycleLogs, setLifecycleLogs] = useState<LifecycleLogs>({
    setup: [],
    run: [],
    teardown: [],
  });

  const taskEnv = useMemo(() => {
    if (!task || !task.path || !projectPath) return undefined;
    return getTaskEnvVars({
      taskId: task.id,
      taskName: task.name,
      taskPath: task.path,
      projectPath,
      defaultBranch,
      portSeed,
    });
  }, [task?.id, task?.name, task?.path, projectPath, defaultBranch, portSeed]);

  useEffect(() => {
    activeTaskIdRef.current = task?.id ?? null;
  }, [task?.id]);

  // Sync active terminal when task terminals or global terminals change
  useEffect(() => {
    if (task && taskTerminals.terminals.length > 0) {
      if (
        !activeTerminalId ||
        (terminalScope === 'task' &&
          !taskTerminals.terminals.some((t) => t.id === activeTerminalId))
      ) {
        setActiveTerminalId(taskTerminals.terminals[0].id);
        setTerminalScope('task');
      }
    } else if (globalTerminals.terminals.length > 0) {
      if (
        !activeTerminalId ||
        (terminalScope === 'global' &&
          !globalTerminals.terminals.some((t) => t.id === activeTerminalId))
      ) {
        setActiveTerminalId(globalTerminals.terminals[0].id);
        setTerminalScope('global');
      }
    }
  }, [task, taskTerminals.terminals, globalTerminals.terminals, activeTerminalId, terminalScope]);

  // When no task, switch to terminal tab and global scope
  useEffect(() => {
    if (!task) {
      setActiveTab('terminal');
      setTerminalScope('global');
    }
  }, [task]);

  const refreshLifecycleState = useCallback(async () => {
    const taskId = task?.id;
    if (!taskId) return;
    const api = window.electronAPI as any;
    if (typeof api?.lifecycleGetState !== 'function') return;
    try {
      const res = await api.lifecycleGetState({ taskId });
      if (activeTaskIdRef.current !== taskId) return;
      if (!res?.success || !res.state) return;
      if (res.state.run?.status) setRunStatus(res.state.run.status);
      if (res.state.setup?.status) setSetupStatus(res.state.setup.status);
      if (res.state.teardown?.status) setTeardownStatus(res.state.teardown.status);
    } catch {}
  }, [task?.id]);

  useEffect(() => {
    setRunStatus('idle');
    setSetupStatus('idle');
    setTeardownStatus('idle');
    setRunActionBusy(false);
    setLifecycleLogs({ setup: [], run: [], teardown: [] });
    if (!task) return;

    const api = window.electronAPI as any;
    let cancelled = false;

    void refreshLifecycleState();

    if (typeof api?.onLifecycleEvent !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    const off = api.onLifecycleEvent((evt: any) => {
      if (!evt || evt.taskId !== task.id) return;
      const phase =
        evt.phase === 'setup' || evt.phase === 'run' || evt.phase === 'teardown'
          ? (evt.phase as LifecyclePhase)
          : null;
      if (phase) {
        if (evt.status === 'starting') {
          setLifecycleLogs((prev) => ({
            ...prev,
            [phase]: [...prev[phase], `$ ${phase} started\n`].slice(-300),
          }));
        } else if (evt.status === 'line' && typeof evt.line === 'string') {
          setLifecycleLogs((prev) => ({
            ...prev,
            [phase]: [...prev[phase], evt.line].slice(-300),
          }));
        } else if (evt.status === 'done') {
          setLifecycleLogs((prev) => ({
            ...prev,
            [phase]: [...prev[phase], `$ ${phase} finished (exit ${evt.exitCode ?? 0})\n`].slice(
              -300
            ),
          }));
        } else if (evt.status === 'error') {
          const detail = typeof evt.error === 'string' ? `: ${evt.error}` : '';
          setLifecycleLogs((prev) => ({
            ...prev,
            [phase]: [
              ...prev[phase],
              `$ ${phase} failed (exit ${evt.exitCode ?? 'unknown'})${detail}\n`,
            ].slice(-300),
          }));
        } else if (phase === 'run' && evt.status === 'exit') {
          const code = evt.exitCode === null ? 'signal' : evt.exitCode;
          setLifecycleLogs((prev) => ({
            ...prev,
            run: [...prev.run, `$ run exited (${code})\n`].slice(-300),
          }));
        }
      }

      if (evt.phase === 'setup') {
        if (evt.status === 'starting') setSetupStatus('running');
        if (evt.status === 'done') setSetupStatus('succeeded');
        if (evt.status === 'error') setSetupStatus('failed');
        return;
      }
      if (evt.phase === 'teardown') {
        if (evt.status === 'starting') setTeardownStatus('running');
        if (evt.status === 'done') setTeardownStatus('succeeded');
        if (evt.status === 'error') setTeardownStatus('failed');
        return;
      }
      if (evt.phase !== 'run') return;
      if (evt.status === 'starting') {
        setRunStatus('running');
        return;
      }
      if (evt.status === 'error') {
        setRunStatus('failed');
        return;
      }
      if (evt.status === 'exit') {
        void (async () => {
          if (cancelled) return;
          const apiInner = window.electronAPI as any;
          if (typeof apiInner?.lifecycleGetState === 'function') {
            try {
              const res = await apiInner.lifecycleGetState({ taskId: task.id });
              if (!cancelled && res?.success && res.state?.run?.status) {
                setRunStatus(res.state.run.status);
                return;
              }
            } catch {}
          }
          if (cancelled) return;
          if (evt.exitCode === 0) setRunStatus('succeeded');
          else if (typeof evt.exitCode === 'number') setRunStatus('failed');
          else setRunStatus('idle');
        })();
      }
    });

    return () => {
      cancelled = true;
      off?.();
    };
  }, [task?.id, refreshLifecycleState]);

  // Auto-switch to Setup tab when setup starts running
  useEffect(() => {
    if (setupStatus === 'running') {
      setActiveTab('setup');
    }
  }, [setupStatus]);

  // Auto-switch to Run tab when the run phase starts
  useEffect(() => {
    if (runStatus === 'running') {
      setActiveTab('run');
    }
  }, [runStatus]);

  const canStartRun =
    !!task &&
    !!projectPath &&
    !runActionBusy &&
    runStatus !== 'running' &&
    setupStatus !== 'running' &&
    setupStatus !== 'failed';

  const handleRunStart = useCallback(async () => {
    if (!task || !projectPath) return;
    const api = window.electronAPI as any;
    setRunActionBusy(true);
    try {
      // If setup hasn't succeeded yet, check whether there's a setup script
      // and run it first (the backend rejects run when setup is configured
      // but hasn't completed).
      if (setupStatus !== 'succeeded') {
        const scriptRes = await api.lifecycleGetScript?.({
          projectPath,
          phase: 'setup',
        });
        if (scriptRes?.success && scriptRes.script) {
          setActiveTab('setup');
          const setupRes = await api.lifecycleSetup?.({
            taskId: task.id,
            taskPath: task.path,
            projectPath,
            taskName: task.name,
          });
          if (!setupRes?.success) {
            console.error('Setup failed, cannot start run:', setupRes?.error);
            return;
          }
          // After setup completes switch to run tab
          setActiveTab('run');
        }
      }

      await api.lifecycleRunStart?.({
        taskId: task.id,
        taskPath: task.path,
        projectPath,
        taskName: task.name,
      });
    } catch (error) {
      console.error('Failed lifecycle run start:', error);
    } finally {
      setRunActionBusy(false);
      void refreshLifecycleState();
    }
  }, [task?.id, task?.name, task?.path, projectPath, setupStatus, refreshLifecycleState]);

  const handleRunStop = useCallback(async () => {
    if (!task) return;
    const api = window.electronAPI as any;
    setRunActionBusy(true);
    try {
      await api.lifecycleRunStop?.({ taskId: task.id });
    } catch (error) {
      console.error('Failed to stop run phase:', error);
    } finally {
      setRunActionBusy(false);
      void refreshLifecycleState();
    }
  }, [task?.id, refreshLifecycleState]);

  const handleSetupPlay = useCallback(async () => {
    if (!task || !projectPath) return;
    const api = window.electronAPI as any;
    setRunActionBusy(true);
    try {
      await api.lifecycleSetup?.({
        taskId: task.id,
        taskPath: task.path,
        projectPath,
        taskName: task.name,
      });
    } catch (error) {
      console.error('Failed lifecycle setup:', error);
    } finally {
      setRunActionBusy(false);
      void refreshLifecycleState();
    }
  }, [task?.id, task?.name, task?.path, projectPath, refreshLifecycleState]);

  /** ⌘R / Ctrl+R: toggle run or switch to run tab */
  const handleRunShortcut = useCallback(() => {
    if (!task || !projectPath) return;
    if (runStatus === 'running') {
      void handleRunStop();
    } else if (canStartRun) {
      setActiveTab('run');
      void handleRunStart();
    }
  }, [task, projectPath, runStatus, canStartRun, handleRunStart, handleRunStop]);

  /** Run button click — always triggers run regardless of active tab */
  const handleRunButtonClick = useCallback(() => {
    if (runStatus === 'running') {
      void handleRunStop();
    } else if (canStartRun) {
      setActiveTab('run');
      void handleRunStart();
    }
  }, [runStatus, canStartRun, handleRunStart, handleRunStop]);

  // Register ⌘R / Ctrl+R keyboard shortcut
  useEffect(() => {
    const isMac =
      typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

    const handleKeyDown = (e: KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      if (modKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        e.stopPropagation();
        handleRunShortcut();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleRunShortcut]);

  const [nativeTheme, setNativeTheme] = useState<{
    background?: string;
    foreground?: string;
    cursor?: string;
    cursorAccent?: string;
    selectionBackground?: string;
    black?: string;
    red?: string;
    green?: string;
    yellow?: string;
    blue?: string;
    magenta?: string;
    cyan?: string;
    white?: string;
    brightBlack?: string;
    brightRed?: string;
    brightGreen?: string;
    brightYellow?: string;
    brightBlue?: string;
    brightMagenta?: string;
    brightCyan?: string;
    brightWhite?: string;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await window.electronAPI.terminalGetTheme();
        if (result?.ok && result.config?.theme) setNativeTheme(result.config.theme);
      } catch (error) {
        console.warn('Failed to load native terminal theme', error);
      }
    })();
  }, []);

  const defaultTheme = useMemo(() => {
    const isMistral = agent === 'mistral';
    const darkBackground = isMistral ? '#202938' : '#1e1e1e';
    const blackBackground = isMistral ? '#141820' : '#000000';

    return effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
      ? {
          background: effectiveTheme === 'dark-black' ? blackBackground : darkBackground,
          foreground: '#d4d4d4',
          cursor: '#aeafad',
          cursorAccent: effectiveTheme === 'dark-black' ? blackBackground : darkBackground,
          selectionBackground: 'rgba(96, 165, 250, 0.35)',
          selectionForeground: '#f9fafb',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#ffffff',
        }
      : {
          background: '#ffffff',
          foreground: '#1e1e1e',
          cursor: '#1e1e1e',
          cursorAccent: '#ffffff',
          selectionBackground: 'rgba(59, 130, 246, 0.35)',
          selectionForeground: '#0f172a',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#bf8803',
          blue: '#0451a5',
          magenta: '#bc05bc',
          cyan: '#0598bc',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#cd3131',
          brightGreen: '#14ce14',
          brightYellow: '#b5ba00',
          brightBlue: '#0451a5',
          brightMagenta: '#bc05bc',
          brightCyan: '#0598bc',
          brightWhite: '#a5a5a5',
        };
  }, [effectiveTheme, agent]);

  const themeOverride = useMemo(() => {
    if (!nativeTheme) return defaultTheme;
    return { ...defaultTheme, ...nativeTheme };
  }, [nativeTheme, defaultTheme]);

  const totalTerminals = taskTerminals.terminals.length + globalTerminals.terminals.length;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  if (!task && !projectPath) {
    return (
      <div className={`flex h-full flex-col items-center justify-center bg-muted ${className}`}>
        <Bot className="mb-2 h-8 w-8 text-muted-foreground" />
        <h3 className="mb-1 text-sm text-muted-foreground">No Task Selected</h3>
        <p className="text-center text-xs text-muted-foreground dark:text-muted-foreground">
          Select a task to view its terminal
        </p>
      </div>
    );
  }

  const runButtonDisabled = shouldDisablePlay({
    runActionBusy,
    hasProjectPath: !!projectPath,
    isRunSelection: true,
    canStartRun,
  });

  const tabs: { id: TabId; label: string }[] = task
    ? [
        { id: 'setup', label: 'Setup' },
        { id: 'run', label: 'Run' },
        { id: 'terminal', label: 'Terminal' },
      ]
    : [{ id: 'terminal', label: 'Terminal' }];

  return (
    <div className={cn('flex h-full min-w-0 flex-col bg-card', className)}>
      {/* Tab bar header */}
      <div className="flex items-center border-b border-border bg-muted dark:bg-background">
        {/* Collapse/expand toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-full shrink-0 items-center px-2 text-muted-foreground hover:text-foreground"
          title={collapsed ? 'Expand terminal panel' : 'Collapse terminal panel'}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Tabs */}
        <div className="flex min-w-0 items-center gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative px-3 py-1.5 text-xs font-medium transition-colors',
                activeTab === tab.id
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
              {/* Active indicator underline */}
              {activeTab === tab.id && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground" />
              )}
            </button>
          ))}

          {/* + button for new terminal */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      const { captureTelemetry } = await import('../lib/telemetryClient');
                      captureTelemetry('terminal_new_terminal_created', {
                        scope: task ? 'task' : 'global',
                      });
                    })();
                    if (task) {
                      taskTerminals.createTerminal({ cwd: task.path });
                    } else if (projectPath) {
                      globalTerminals.createTerminal({ cwd: projectPath });
                    }
                    setActiveTab('terminal');
                  }}
                  className="flex items-center px-2 py-1.5 text-muted-foreground hover:text-foreground"
                  title="New terminal"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">New terminal</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Run button (always visible when task exists) */}
        {task && (
          <div className="flex shrink-0 items-center pr-2">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRunButtonClick}
                    disabled={runStatus !== 'running' && runButtonDisabled}
                    className={cn(
                      'h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground',
                      runStatus === 'running' && 'text-foreground'
                    )}
                  >
                    {runStatus === 'running' ? (
                      <Square className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    <span>{runStatus === 'running' ? 'Stop' : 'Run'}</span>
                    <span className="ml-0.5 text-[10px] text-muted-foreground">
                      {isMac ? '⌘R' : 'Ctrl+R'}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">
                    {runStatus === 'running'
                      ? 'Stop run script'
                      : setupStatus === 'running'
                        ? 'Setup is still running'
                        : setupStatus === 'failed'
                          ? 'Setup failed'
                          : 'Start run script'}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>

      {/* Collapsed state — show nothing */}
      {collapsed ? null : (
        <>
          {/* Setup tab content */}
          {activeTab === 'setup' && task && (
            <div className="flex h-full flex-1 flex-col overflow-hidden">
              <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                Setup status: {setupStatus}
              </div>
              {lifecycleLogs.setup.length > 0 ? (
                <pre className="h-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-foreground">
                  {lifecycleLogs.setup.join('')}
                </pre>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-sm text-muted-foreground">
                  <p className="mb-1 font-medium">No setup script output</p>
                  <p className="mb-4 text-xs">
                    Setup script output will appear here after running setup.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSetupPlay}
                    disabled={runActionBusy || !projectPath}
                    className="gap-1.5"
                  >
                    <Play className="h-3 w-3" />
                    Run setup
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Run tab content */}
          {activeTab === 'run' && task && (
            <div className="flex h-full flex-1 flex-col overflow-hidden">
              <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                Run status: {runStatus}
              </div>
              {lifecycleLogs.run.length > 0 ? (
                <pre className="h-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-foreground">
                  {lifecycleLogs.run.join('')}
                </pre>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-sm text-muted-foreground">
                  <p className="mb-1 font-medium">No run script output</p>
                  <p className="mb-4 text-xs">
                    Run script output will appear here after starting the app.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRunButtonClick}
                    disabled={runStatus !== 'running' && runButtonDisabled}
                    className="gap-1.5"
                  >
                    <Play className="h-3 w-3" />
                    Run app
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Terminal tab content */}
          {activeTab === 'terminal' && (
            <div
              className={cn(
                'bw-terminal relative flex-1 overflow-hidden',
                effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
                  ? agent === 'mistral'
                    ? effectiveTheme === 'dark-black'
                      ? 'bg-[#141820]'
                      : 'bg-[#202938]'
                    : 'bg-card'
                  : 'bg-white'
              )}
            >
              {taskTerminals.terminals.map((terminal) => {
                const isActive = terminalScope === 'task' && terminal.id === activeTerminalId;
                return (
                  <div
                    key={`task::${terminal.id}`}
                    className={cn(
                      'absolute inset-0 h-full w-full transition-opacity',
                      isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
                    )}
                  >
                    <TerminalPane
                      id={terminal.id}
                      cwd={terminal.cwd || task?.path}
                      remote={
                        remote?.connectionId ? { connectionId: remote.connectionId } : undefined
                      }
                      env={taskEnv}
                      variant={
                        effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
                          ? 'dark'
                          : 'light'
                      }
                      themeOverride={themeOverride}
                      className="h-full w-full"
                      keepAlive
                    />
                  </div>
                );
              })}
              {globalTerminals.terminals.map((terminal) => {
                const isActive = terminalScope === 'global' && terminal.id === activeTerminalId;
                return (
                  <div
                    key={`global::${terminal.id}`}
                    className={cn(
                      'absolute inset-0 h-full w-full transition-opacity',
                      isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
                    )}
                  >
                    <TerminalPane
                      id={terminal.id}
                      cwd={terminal.cwd || projectPath}
                      remote={
                        remote?.connectionId ? { connectionId: remote.connectionId } : undefined
                      }
                      variant={
                        effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
                          ? 'dark'
                          : 'light'
                      }
                      themeOverride={themeOverride}
                      className="h-full w-full"
                      keepAlive
                    />
                  </div>
                );
              })}
              {totalTerminals === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-xs text-muted-foreground">
                  <p>No terminal found.</p>
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const TaskTerminalPanel = React.memo(TaskTerminalPanelComponent);

export default TaskTerminalPanel;
