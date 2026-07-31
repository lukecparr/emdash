import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { WorkHub } from './components/work-hub';

export function WorkHubTitlebar() {
  return (
    <Titlebar
      leftSlot={
        <nav aria-label="Breadcrumb" className="flex items-center px-2">
          <span className="max-w-[14rem] truncate rounded-sm px-1 py-0.5 text-sm text-foreground">
            Work
          </span>
        </nav>
      }
    />
  );
}

export function WorkHubMainPanel() {
  return <WorkHub />;
}

export const workHubView = {
  TitlebarSlot: WorkHubTitlebar,
  MainPanel: WorkHubMainPanel,
};
