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
import { FocusScrollView } from './FocusScroll';
import { Footer } from './Footer';
import { StatusRow } from './StatusRow';
import { useUiScale } from './scale';
import { statusA11y } from './visualOnly';

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
  /** The caller renders its own controls (dialog, join confirmation). */
  hideActions?: boolean;
  /** UI-owned heading used instead of view.title (security-critical prompts whose wording the UI guarantees). */
  titleOverride?: string;
  /** Do not render view.body (the caller renders its own text). */
  hideBody?: boolean;
  /** Do not render a screen title (the caller renders the only heading, for example a dialog's own title). */
  hideTitle?: boolean;
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
  titleOverride,
  hideBody = false,
  hideTitle = false,
}: ScreenFrameProps): React.ReactElement {
  const ui = useUiScale();
  const orientation = !view.capturing && view.actions.length > 1 ? text.orientationActions : undefined;
  // A11Y-04: the scroll area clips anything outside its padding box, and a focused control (6 px ring, 1.05 scale) grows
  // beyond its layout box. The page padding is split: `inset` stays inside the scroll area (and the footer, so text
  // keeps one left edge) and only the remainder is outside it, so the visible layout is unchanged.
  const inset = ui.size(layout.ringInset);
  const insetBottom = ui.size(layout.ringInsetBottom);
  const outer = Math.max(0, ui.space(layout.pagePadding) - inset);
  return (
    <View
      testID={'screen-' + view.screen}
      accessibilityOrientationText={orientation}
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingHorizontal: outer,
        paddingVertical: ui.space(ui.factor >= layout.largeScaleFactor ? layout.pageVerticalPaddingLarge : layout.pageVerticalPadding),
      }}
    >
      {/* Everything except the footer scrolls when it is taller than the canvas (large UI scales); the footer stays put. */}
      <FocusScrollView resetKey={view.screen + ':' + view.stage} inset={{ x: inset, bottom: insetBottom }}>
        {/* Title and status chips share one row; the chips wrap under a long title instead of taking a row of their own. */}
        <View testID="header" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          {hideTitle ? null : (
            <AppText
              testID="screen-title"
              nativeID="atr-title"
              kind="title"
              role={view.capturing ? undefined : 'heading'}
              style={{ flexShrink: 1, marginRight: ui.space(32) }}
            >
              {titleOverride ?? view.title}
            </AppText>
          )}
          {hideStatus ? null : <StatusRow mic={view.mic} link={view.link} capturing={view.capturing} />}
        </View>
        {view.labels.length > 0 ? (
          <View testID="labels" style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: ui.space(8) }}>
            {view.labels.map((label) => (
              <View
                key={label}
                {...statusA11y(view.capturing, label)}
                style={{ borderWidth: 2, borderColor: colors.neutral, borderRadius: ui.size(12), paddingHorizontal: ui.space(16), marginRight: ui.space(16), marginBottom: ui.space(8) }}
              >
                <AppText kind="body" color={colors.neutral}>
                  {label}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}
        {view.banner !== null ? <Banner banner={view.banner} capturing={view.capturing} /> : null}
        <View testID="body" style={{ marginTop: ui.space(10) }}>
          {(hideBody ? [] : view.body).map((line, index) => (
            <AppText
              key={index + ':' + line}
              nativeID={'atr-body-' + index}
              kind={bodyKind}
              role={index === 0 && !view.capturing ? 'summary' : undefined}
              style={{ marginBottom: ui.space(6) }}
            >
              {line}
            </AppText>
          ))}
        </View>
        <View testID="content" style={{ flex: 1, minHeight: 0, justifyContent: 'center', alignItems: 'center' }}>
          {children}
        </View>
        {hideActions ? null : (
          <ActionRow
            actions={view.actions}
            preferredAction={view.preferredAction}
            onAction={onAction}
            direction={actionsDirection}
            describedBy={describedBy}
            capturing={view.capturing}
          />
        )}
      </FocusScrollView>
      <View style={{ paddingHorizontal: inset }}>
        <Announcer announcement={view.announcement} capturing={view.capturing} />
        <Footer text={view.footer} />
      </View>
    </View>
  );
}
