import React from 'react';
import { motion } from 'framer-motion';
import { Pin } from 'lucide-react';
import { TaskItem } from './TaskItem';
import { usePrStatus } from '../hooks/usePrStatus';
import { deriveLifecycleStage, LIFECYCLE_GROUPS } from '../lib/lifecycleStage';
import type { LifecycleStage } from '../lib/lifecycleStage';
import type { Task } from '../types/chat';
import type { Project } from '../types/app';

interface GroupedTaskListProps {
  project: Project;
  tasks: Task[];
  activeTask?: Task | null;
  pinnedTaskIds?: Set<string>;
  onSelectTask?: (task: Task) => void;
  onSelectProject?: (project: Project) => void;
  selectedProject?: Project | null;
  onPinTask?: (task: Task) => void;
  onRenameTask?: (project: Project, task: Task, newName: string) => void | Promise<void>;
  onArchiveTask?: (project: Project, task: Task) => void | Promise<void | boolean>;
  onNavigate: (callback: () => void) => void;
}

/**
 * Renders tasks grouped by lifecycle stage within a project.
 * Pinned tasks float above all groups.
 */
const GroupedTaskList: React.FC<GroupedTaskListProps> = ({
  project,
  tasks,
  activeTask,
  pinnedTaskIds,
  onSelectTask,
  onSelectProject,
  selectedProject,
  onPinTask,
  onRenameTask,
  onArchiveTask,
  onNavigate,
}) => {
  // Separate pinned vs unpinned
  const pinned = tasks.filter((t) => pinnedTaskIds?.has(t.id));
  const unpinned = tasks.filter((t) => !pinnedTaskIds?.has(t.id));

  const renderTaskItem = (task: Task) => {
    const isActive = activeTask?.id === task.id;
    return (
      <motion.div
        key={task.id}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: 0.1, ease: 'easeInOut' }}
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(() => {
            if (onSelectProject && selectedProject?.id !== project.id) {
              onSelectProject(project);
            }
            onSelectTask?.(task);
          });
        }}
        className={`group/task min-w-0 rounded-md py-1.5 pl-1 pr-2 hover:bg-accent ${
          isActive ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''
        }`}
        title={task.name}
      >
        <TaskItem
          task={task}
          showDelete={false}
          showDirectBadge={false}
          showStatusDot
          isPinned={pinnedTaskIds?.has(task.id)}
          onPin={onPinTask ? () => onPinTask(task) : undefined}
          onRename={
            onRenameTask && !task.metadata?.multiAgent?.enabled
              ? (newName) => onRenameTask(project, task, newName)
              : undefined
          }
          onArchive={onArchiveTask ? () => onArchiveTask(project, task) : undefined}
        />
      </motion.div>
    );
  };

  // We need to collect tasks per stage. Since each TaskStageResolver subscribes
  // internally, we use a collect-then-render pattern with a state holder.
  return (
    <GroupedTaskListInner unpinned={unpinned} pinned={pinned} renderTaskItem={renderTaskItem} />
  );
};

/**
 * Inner component that resolves stages for all unpinned tasks and groups them.
 */
const GroupedTaskListInner: React.FC<{
  unpinned: Task[];
  pinned: Task[];
  renderTaskItem: (task: Task) => React.ReactNode;
}> = ({ unpinned, pinned, renderTaskItem }) => {
  // Each task subscribes to its own PR status to determine stage
  const [stageMap, setStageMap] = React.useState<Record<string, LifecycleStage>>({});

  // Group unpinned tasks by their resolved stage
  const groups: Record<LifecycleStage, Task[]> = {
    working: [],
    draft: [],
    'in-review': [],
    approved: [],
    merged: [],
  };

  for (const task of unpinned) {
    const stage = stageMap[task.id] || 'working';
    // Merged tasks go into the approved group (same visual section)
    const targetStage = stage === 'merged' ? 'approved' : stage;
    groups[targetStage].push(task);
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {/* Pinned tasks float above all groups */}
      {pinned.length > 0 && (
        <div className="mb-1">
          <div className="flex items-center gap-1.5 px-1 py-0.5">
            <Pin className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
              Pinned
            </span>
          </div>
          {pinned.map((task) => renderTaskItem(task))}
        </div>
      )}

      {/* Lifecycle groups — always visible */}
      {LIFECYCLE_GROUPS.map(({ stage, label }) => {
        const tasksInGroup = groups[stage] || [];
        return (
          <div key={stage} className="mb-0.5">
            <div className="flex items-center gap-1.5 px-1 py-0.5">
              <StageIcon stage={stage} />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                {label}
              </span>
              {tasksInGroup.length > 0 && (
                <span className="text-[10px] tabular-nums text-muted-foreground/40">
                  {tasksInGroup.length}
                </span>
              )}
            </div>
            {tasksInGroup.length > 0 && tasksInGroup.map((task) => renderTaskItem(task))}
          </div>
        );
      })}

      {/* Hidden stage resolvers that update stageMap */}
      {unpinned.map((task) => (
        <TaskStageUpdater key={task.id} task={task} onStageChange={setStageMap} />
      ))}
    </div>
  );
};

/** Tiny colored icon for each lifecycle stage */
const StageIcon: React.FC<{ stage: LifecycleStage }> = ({ stage }) => {
  const colors: Record<LifecycleStage, string> = {
    working: 'bg-muted-foreground/40',
    draft: 'bg-muted-foreground/40',
    'in-review': 'bg-blue-500',
    approved: 'bg-emerald-500',
    merged: 'bg-purple-500',
  };
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${colors[stage]}`} />;
};

/**
 * Invisible component that subscribes to a task's PR status and reports
 * the derived lifecycle stage back to the parent via a setter.
 * This avoids re-rendering the entire list when one task's stage changes.
 */
const TaskStageUpdater: React.FC<{
  task: Task;
  onStageChange: React.Dispatch<React.SetStateAction<Record<string, LifecycleStage>>>;
}> = React.memo(({ task, onStageChange }) => {
  const { pr } = usePrStatus(task.path);
  const stage = deriveLifecycleStage(pr);

  React.useEffect(() => {
    onStageChange((prev) => {
      if (prev[task.id] === stage) return prev;
      return { ...prev, [task.id]: stage };
    });
  }, [task.id, stage, onStageChange]);

  return null;
});

TaskStageUpdater.displayName = 'TaskStageUpdater';

export default GroupedTaskList;
