import * as React from 'react';
import type { TvView } from '@atr/session-core';
import { ScreenFrame } from '../ui/ScreenFrame';
import type { ScreenProps } from '../ui/ScreenFrame';
import { AboutScreen } from './AboutScreen';
import { ConfirmDialogScreen } from './ConfirmDialogScreen';
import { DiagnosticsScreen } from './DiagnosticsScreen';
import { HistoryScreen } from './HistoryScreen';
import { HomeScreen, OnboardingScreen } from './HomeScreen';
import {
  CalibrationScreen,
  PermissionPendingScreen,
  PhraseScreen,
  QuietCheckScreen,
  ResponseScreen,
  RevealScreen,
  VowelScreen,
} from './MeasureScreens';
import { JoinConfirmScreen, PairingScreen } from './PairingScreen';
import { PausedOrInvalidScreen, ResumeOrDiscardScreen } from './PausedScreens';
import { SettingsScreen } from './SettingsScreen';
import { SummaryScreen } from './SummaryScreen';

/**
 * Generic renderer: picks the dedicated component for `view.screen`. A dialog in the view always wins, so a
 * confirmation can never be hidden behind another screen. An unknown screen id still renders title, body,
 * controls and footer instead of a blank screen.
 */
export function ScreenRouter({ view, onAction }: ScreenProps): React.ReactElement {
  if (view.dialog !== null) return <ConfirmDialogScreen view={view} onAction={onAction} />;
  return <ScreenSwitch view={view} onAction={onAction} />;
}

function ScreenSwitch({ view, onAction }: { view: TvView; onAction: ScreenProps['onAction'] }): React.ReactElement {
  const props = { view, onAction };
  switch (view.screen) {
    case 'onboarding':
      return <OnboardingScreen {...props} />;
    case 'home':
      return <HomeScreen {...props} />;
    case 'pairing':
      return <PairingScreen {...props} />;
    case 'join_confirm':
      return <JoinConfirmScreen {...props} />;
    case 'permission_pending':
      return <PermissionPendingScreen {...props} />;
    case 'quiet_check':
      return <QuietCheckScreen {...props} />;
    case 'calibration':
      return <CalibrationScreen {...props} />;
    case 'vowel':
      return <VowelScreen {...props} />;
    case 'phrase':
      return <PhraseScreen {...props} />;
    case 'response':
      return <ResponseScreen {...props} />;
    case 'reveal':
      return <RevealScreen {...props} />;
    case 'summary':
      return <SummaryScreen {...props} />;
    case 'history':
      return <HistoryScreen {...props} />;
    case 'paused_or_invalid':
      return <PausedOrInvalidScreen {...props} />;
    case 'resume_or_discard':
      return <ResumeOrDiscardScreen {...props} />;
    case 'settings':
      return <SettingsScreen {...props} />;
    case 'confirm_dialog':
      return <ConfirmDialogScreen {...props} />;
    case 'about':
      return <AboutScreen {...props} />;
    case 'diagnostics':
      return <DiagnosticsScreen {...props} />;
    default:
      return <ScreenFrame {...props} />;
  }
}
