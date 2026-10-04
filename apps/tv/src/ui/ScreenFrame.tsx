import * as React from 'react';
import { View } from 'react-native';
import type { ActionId, TvView } from '@atr/session-core';
import { text } from '../copy';
import { colors, layout } from '../theme';
import { ActionRow } from './ActionRow';
import { Announcer } from './Announcer';
import { AppText } from './AppText';
import type { TextKind } from './AppText';
import { Banner } from './Banner';
import { Footer } from './Footer';
import { StatusRow } from './StatusRow';
import { useUiScale } from './scale';

export interface ScreenProps {
  view: TvView;
  onAction: (id: ActionId) => void;
}

export interface ScreenFrameProps extends ScreenProps {
  children?: React.ReactNode;
  actionsDirection?: 'row' | 'column';
  /** nativeIDs of static text VoiceView should read together with each control. */
  describedBy?: string[];
  bodyKind?: TextKind;
  /** Hide the phone microphone / relay chips (used by the dialog, about and diagnostics screens). */
  hideStatus?: boolean;
  /** The caller renders its own controls (dialog). */
  hideActions?: boolean;
}

/**
 * Shared layout for every screen: title, status chips, persistent labels, banner, body, screen-specific
 * content, controls, the screen-reader live region and the footer (always present).
 */
export function ScreenFrame({
  view,
  onAction,
  children,
  actionsDirection = 'row',
  describedBy,
  bodyKind = 'body',
  hideStatus = false,
  hideActions = false,
}: ScreenFrameProps): React.ReactElement {
  const ui = useUiScale();
  const orientation = !view.capturing && view.actions.length > 1 ? text.orientationActions : undefined;
  return (
    <View
      testID={'screen-' + view.screen}
      accessibilityOrientationText={orientation}
      style={{ flex: 1, backgroundColor: colors.background, padding: ui.space(layout.pagePadding) }}
    >
      <AppText testID="screen-title" nativeID="atr-title" kind="title" role={view.capturing ? undefined : 'heading'}>
        {view.title}
      </AppText>
      {hideStatus ? null : (
        <View style={{ marginTop: ui.space(12) }}>
          <StatusRow mic={view.mic} link={view.link} />
        </View>
      )}
      {view.labels.length > 0 ? (
        <View testID="labels" style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: ui.space(8) }}>
          {view.labels.map((label) => (
            <View
              key={label}
              accessible
             
              aria-label={label}
              style={{ borderWidth: 2, borderColor: colors.neutral, borderRadius: ui.size(12), paddingHorizontal: ui.space(16), marginRight: ui.space(16), marginBottom: ui.space(8) }}
            >
              <AppText kind="body" color={colors.neutral}>
                {label}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
      {view.banner !== null ? <Banner banner={view.banner} /> : null}
      <View testID="body" style={{ marginTop: ui.space(16) }}>
        {view.body.map((line, index) => (
          <AppText
            key={index + ':' + line}
            nativeID={'atr-body-' + index}
            kind={bodyKind}
            role={index === 0 && !view.capturing ? 'summary' : undefined}
            style={{ marginBottom: ui.space(8) }}
          >
            {line}
          </AppText>
        ))}
      </View>
      <View testID="content" style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        {children}
      </View>
      {hideActions ? null : (
        <ActionRow
          actions={view.actions}
          preferredAction={view.preferredAction}
          onAction={onAction}
          direction={actionsDirection}
          describedBy={describedBy}
        />
      )}
      <Announcer announcement={view.announcement} capturing={view.capturing} />
      <Footer text={view.footer} />
    </View>
  );
}
