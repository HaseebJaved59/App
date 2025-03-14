import {UNSTABLE_usePreventRemove, useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import type {ForwardedRef, ReactNode} from 'react';
import React, {createContext, forwardRef, useContext, useEffect, useMemo, useRef, useState} from 'react';
import type {StyleProp, ViewStyle} from 'react-native';
import {Keyboard, NativeModules, PanResponder, View} from 'react-native';
import {PickerAvoidingView} from 'react-native-picker-select';
import type {EdgeInsets} from 'react-native-safe-area-context';
import useEnvironment from '@hooks/useEnvironment';
import useInitialDimensions from '@hooks/useInitialWindowDimensions';
import useResponsiveLayout from '@hooks/useResponsiveLayout';
import useStyledSafeAreaInsets from '@hooks/useStyledSafeAreaInsets';
import useTackInputFocus from '@hooks/useTackInputFocus';
import useThemeStyles from '@hooks/useThemeStyles';
import useWindowDimensions from '@hooks/useWindowDimensions';
import {isMobile, isMobileWebKit, isSafari} from '@libs/Browser';
import type {PlatformStackNavigationProp} from '@libs/Navigation/PlatformStackNavigation/types';
import type {ReportsSplitNavigatorParamList, RootNavigatorParamList} from '@libs/Navigation/types';
import addViewportResizeListener from '@libs/VisualViewport';
import toggleTestToolsModal from '@userActions/TestTool';
import CONST from '@src/CONST';
import CustomDevMenu from './CustomDevMenu';
import CustomStatusBarAndBackgroundContext from './CustomStatusBarAndBackground/CustomStatusBarAndBackgroundContext';
import FocusTrapForScreens from './FocusTrap/FocusTrapForScreen';
import type FocusTrapForScreenProps from './FocusTrap/FocusTrapForScreen/FocusTrapProps';
import HeaderGap from './HeaderGap';
import ImportedStateIndicator from './ImportedStateIndicator';
import {useInputBlurContext} from './InputBlurContext';
import KeyboardAvoidingView from './KeyboardAvoidingView';
import ModalContext from './Modal/ModalContext';
import OfflineIndicator from './OfflineIndicator';
import withNavigationFallback from './withNavigationFallback';

type ScreenWrapperChildrenProps = {
    insets: EdgeInsets;
    safeAreaPaddingBottomStyle?: {
        paddingBottom?: ViewStyle['paddingBottom'];
    };
    didScreenTransitionEnd: boolean;
};

type ScreenWrapperProps = {
    /** Returns a function as a child to pass insets to or a node to render without insets */
    children: ReactNode | React.FC<ScreenWrapperChildrenProps>;

    /** Content to display under the offline indicator */
    bottomContent?: ReactNode;

    /** A unique ID to find the screen wrapper in tests */
    testID: string;

    /** Additional styles to add */
    style?: StyleProp<ViewStyle>;

    /** Additional styles for header gap */
    headerGapStyles?: StyleProp<ViewStyle>;

    /** Styles for the offline indicator */
    offlineIndicatorStyle?: StyleProp<ViewStyle>;

    /** Whether to include padding bottom */
    includeSafeAreaPaddingBottom?: boolean;

    /** Whether to include padding top */
    includePaddingTop?: boolean;

    /** Called when navigated Screen's transition is finished. It does not fire when user exit the page. */
    onEntryTransitionEnd?: () => void;

    /** The behavior to pass to the KeyboardAvoidingView, requires some trial and error depending on the layout/devices used.
     *  Search 'switch(behavior)' in ./node_modules/react-native/Libraries/Components/Keyboard/KeyboardAvoidingView.js for more context */
    keyboardAvoidingViewBehavior?: 'padding' | 'height' | 'position';

    /** Whether KeyboardAvoidingView should be enabled. Use false for screens where this functionality is not necessary */
    shouldEnableKeyboardAvoidingView?: boolean;

    /** Whether picker modal avoiding should be enabled. Should be enabled when there's a picker at the bottom of a
     *  scrollable form, gives a subtly better UX if disabled on non-scrollable screens with a submit button */
    shouldEnablePickerAvoiding?: boolean;

    /** Whether to dismiss keyboard before leaving a screen */
    shouldDismissKeyboardBeforeClose?: boolean;

    /** Whether to use the maxHeight (true) or use the 100% of the height (false) */
    shouldEnableMaxHeight?: boolean;

    /** Whether to use the minHeight. Use true for screens where the window height are changing because of Virtual Keyboard */
    shouldEnableMinHeight?: boolean;

    /** Whether to show offline indicator */
    shouldShowOfflineIndicator?: boolean;

    /** Whether to avoid scroll on virtual viewport */
    shouldAvoidScrollOnVirtualViewport?: boolean;

    /** Whether to use cached virtual viewport height  */
    shouldUseCachedViewportHeight?: boolean;

    /**
     * The navigation prop is passed by the navigator. It is used to trigger the onEntryTransitionEnd callback
     * when the screen transition ends.
     *
     * This is required because transitionEnd event doesn't trigger in the testing environment.
     */
    navigation?: PlatformStackNavigationProp<RootNavigatorParamList> | PlatformStackNavigationProp<ReportsSplitNavigatorParamList>;

    /** Whether to show offline indicator on wide screens */
    shouldShowOfflineIndicatorInWideScreen?: boolean;

    /** Overrides the focus trap default settings */
    focusTrapSettings?: FocusTrapForScreenProps['focusTrapSettings'];
};

type ScreenWrapperStatusContextType = {
    didScreenTransitionEnd: boolean;
    isSafeAreaTopPaddingApplied: boolean;
    isSafeAreaBottomPaddingApplied: boolean;
};

const ScreenWrapperStatusContext = createContext<ScreenWrapperStatusContextType | undefined>(undefined);

function ScreenWrapper(
    {
        shouldEnableMaxHeight = false,
        shouldEnableMinHeight = false,
        includePaddingTop = true,
        keyboardAvoidingViewBehavior = 'padding',
        includeSafeAreaPaddingBottom = true,
        shouldEnableKeyboardAvoidingView = true,
        shouldEnablePickerAvoiding = true,
        headerGapStyles,
        children,
        shouldShowOfflineIndicator = true,
        offlineIndicatorStyle,
        style,
        shouldDismissKeyboardBeforeClose = true,
        onEntryTransitionEnd,
        testID,
        navigation: navigationProp,
        shouldAvoidScrollOnVirtualViewport = true,
        shouldShowOfflineIndicatorInWideScreen = false,
        shouldUseCachedViewportHeight = false,
        focusTrapSettings,
        bottomContent,
    }: ScreenWrapperProps,
    ref: ForwardedRef<View>,
) {
    /**
     * We are only passing navigation as prop from
     * ReportScreen -> ScreenWrapper
     *
     * so in other places where ScreenWrapper is used, we need to
     * fallback to useNavigation.
     */
    const navigationFallback = useNavigation<PlatformStackNavigationProp<RootNavigatorParamList>>();
    const navigation = navigationProp ?? navigationFallback;
    const isFocused = useIsFocused();
    const {windowHeight} = useWindowDimensions(shouldUseCachedViewportHeight);
    // since Modals are drawn in separate native view hierarchy we should always add paddings
    const ignoreInsetsConsumption = !useContext(ModalContext).default;
    const {setRootStatusBarEnabled} = useContext(CustomStatusBarAndBackgroundContext);

    // We need to use isSmallScreenWidth instead of shouldUseNarrowLayout for a case where we want to show the offline indicator only on small screens
    // eslint-disable-next-line rulesdir/prefer-shouldUseNarrowLayout-instead-of-isSmallScreenWidth
    const {isSmallScreenWidth, shouldUseNarrowLayout} = useResponsiveLayout();
    const {initialHeight} = useInitialDimensions();
    const styles = useThemeStyles();
    const {isDevelopment} = useEnvironment();
    const [didScreenTransitionEnd, setDidScreenTransitionEnd] = useState(false);
    const maxHeight = shouldEnableMaxHeight ? windowHeight : undefined;
    const minHeight = shouldEnableMinHeight && !isSafari() ? initialHeight : undefined;

    const route = useRoute();
    const shouldReturnToOldDot = useMemo(() => {
        return !!route?.params && CONST.HYBRID_APP.SINGLE_NEW_DOT_ENTRY in route.params && route.params[CONST.HYBRID_APP.SINGLE_NEW_DOT_ENTRY] === 'true';
    }, [route?.params]);
    const {isBlurred, setIsBlurred} = useInputBlurContext();

    UNSTABLE_usePreventRemove(shouldReturnToOldDot, () => {
        NativeModules.HybridAppModule?.closeReactNativeApp(false, false);
        setRootStatusBarEnabled(false);
    });

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponderCapture: (_e, gestureState) => gestureState.numberActiveTouches === CONST.TEST_TOOL.NUMBER_OF_TAPS,
            onPanResponderRelease: toggleTestToolsModal,
        }),
    ).current;

    const keyboardDismissPanResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponderCapture: (_e, gestureState) => {
                const isHorizontalSwipe = Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
                const shouldDismissKeyboard = shouldDismissKeyboardBeforeClose && Keyboard.isVisible() && isMobile();

                return isHorizontalSwipe && shouldDismissKeyboard;
            },
            onPanResponderGrant: Keyboard.dismiss,
        }),
    ).current;

    useEffect(() => {
        /**
         * Handler to manage viewport resize events specific to Safari.
         * Disables the blur state when Safari is detected.
         */
        const handleViewportResize = () => {
            if (!isSafari()) {
                return; // Exit early if not Safari
            }
            setIsBlurred(false); // Disable blur state for Safari
        };

        // Add the viewport resize listener
        const removeResizeListener = addViewportResizeListener(handleViewportResize);

        // Cleanup function to remove the listener
        return () => {
            removeResizeListener();
        };
    }, [setIsBlurred]);

    useEffect(() => {
        // On iOS, the transitionEnd event doesn't trigger some times. As such, we need to set a timeout
        const timeout = setTimeout(() => {
            setDidScreenTransitionEnd(true);
            onEntryTransitionEnd?.();
        }, CONST.SCREEN_TRANSITION_END_TIMEOUT);

        const unsubscribeTransitionEnd = navigation.addListener('transitionEnd', (event) => {
            // Prevent firing the prop callback when user is exiting the page.
            if (event?.data?.closing) {
                return;
            }
            clearTimeout(timeout);
            setDidScreenTransitionEnd(true);
            onEntryTransitionEnd?.();
        });

        // We need to have this prop to remove keyboard before going away from the screen, to avoid previous screen look weird for a brief moment,
        // also we need to have generic control in future - to prevent closing keyboard for some rare cases in which beforeRemove has limitations
        // described here https://reactnavigation.org/docs/preventing-going-back/#limitations
        const beforeRemoveSubscription = shouldDismissKeyboardBeforeClose
            ? navigation.addListener('beforeRemove', () => {
                  if (!Keyboard.isVisible()) {
                      return;
                  }
                  Keyboard.dismiss();
              })
            : undefined;

        return () => {
            clearTimeout(timeout);
            unsubscribeTransitionEnd();

            if (beforeRemoveSubscription) {
                beforeRemoveSubscription();
            }
        };
        // Rule disabled because this effect is only for component did mount & will component unmount lifecycle event
        // eslint-disable-next-line react-compiler/react-compiler, react-hooks/exhaustive-deps
    }, []);

    const {insets, paddingTop, paddingBottom, safeAreaPaddingBottomStyle, unmodifiedPaddings} = useStyledSafeAreaInsets();
    const paddingTopStyle: StyleProp<ViewStyle> = {};
    const paddingBottomStyle: StyleProp<ViewStyle> = {};

    const isSafeAreaTopPaddingApplied = includePaddingTop;
    if (includePaddingTop) {
        paddingTopStyle.paddingTop = paddingTop;
    }
    if (includePaddingTop && ignoreInsetsConsumption) {
        paddingTopStyle.paddingTop = unmodifiedPaddings.top;
    }

    // We always need the safe area padding bottom if we're showing the offline indicator since it is bottom-docked.
    if (includeSafeAreaPaddingBottom) {
        paddingBottomStyle.paddingBottom = paddingBottom;
    }
    if (includeSafeAreaPaddingBottom && ignoreInsetsConsumption) {
        paddingBottomStyle.paddingBottom = unmodifiedPaddings.bottom;
    }

    const isAvoidingViewportScroll = useTackInputFocus(isFocused && shouldEnableMaxHeight && shouldAvoidScrollOnVirtualViewport && isMobileWebKit());
    const contextValue = useMemo(
        () => ({didScreenTransitionEnd, isSafeAreaTopPaddingApplied, isSafeAreaBottomPaddingApplied: includeSafeAreaPaddingBottom}),
        [didScreenTransitionEnd, includeSafeAreaPaddingBottom, isSafeAreaTopPaddingApplied],
    );

    return (
        <FocusTrapForScreens focusTrapSettings={focusTrapSettings}>
            <View
                ref={ref}
                style={[styles.flex1, {minHeight}]}
                // eslint-disable-next-line react/jsx-props-no-spreading, react-compiler/react-compiler
                {...panResponder.panHandlers}
                testID={testID}
            >
                <View
                    fsClass="fs-unmask"
                    style={[styles.flex1, paddingTopStyle, style]}
                    // eslint-disable-next-line react/jsx-props-no-spreading, react-compiler/react-compiler
                    {...keyboardDismissPanResponder.panHandlers}
                >
                    <KeyboardAvoidingView
                        style={[styles.w100, styles.h100, !isBlurred ? {maxHeight} : undefined, isAvoidingViewportScroll ? [styles.overflowAuto, styles.overscrollBehaviorContain] : {}]}
                        behavior={keyboardAvoidingViewBehavior}
                        enabled={shouldEnableKeyboardAvoidingView}
                    >
                        <PickerAvoidingView
                            style={isAvoidingViewportScroll ? [styles.h100, {marginTop: 1}] : styles.flex1}
                            enabled={shouldEnablePickerAvoiding}
                        >
                            <HeaderGap styles={headerGapStyles} />
                            {isDevelopment && <CustomDevMenu />}
                            <ScreenWrapperStatusContext.Provider value={contextValue}>
                                {
                                    // If props.children is a function, call it to provide the insets to the children.
                                    typeof children === 'function'
                                        ? children({
                                              insets,
                                              safeAreaPaddingBottomStyle,
                                              didScreenTransitionEnd,
                                          })
                                        : children
                                }
                                {isSmallScreenWidth && shouldShowOfflineIndicator && (
                                    <>
                                        <OfflineIndicator
                                            style={[offlineIndicatorStyle]}
                                            containerStyles={
                                                includeSafeAreaPaddingBottom
                                                    ? [styles.offlineIndicatorMobile]
                                                    : [styles.offlineIndicatorMobile, {paddingBottom: paddingBottom + styles.offlineIndicatorMobile.paddingBottom}]
                                            }
                                        />
                                        {/* Since import state is tightly coupled to the offline state, it is safe to display it when showing offline indicator */}
                                        <ImportedStateIndicator />
                                    </>
                                )}
                                {!shouldUseNarrowLayout && shouldShowOfflineIndicatorInWideScreen && (
                                    <>
                                        <OfflineIndicator
                                            containerStyles={[]}
                                            style={[styles.pl5, styles.offlineIndicatorRow, offlineIndicatorStyle]}
                                        />
                                        {/* Since import state is tightly coupled to the offline state, it is safe to display it when showing offline indicator */}
                                        <ImportedStateIndicator />
                                    </>
                                )}
                            </ScreenWrapperStatusContext.Provider>
                        </PickerAvoidingView>
                    </KeyboardAvoidingView>
                </View>
                <View style={paddingBottomStyle}>{bottomContent}</View>
            </View>
        </FocusTrapForScreens>
    );
}

ScreenWrapper.displayName = 'ScreenWrapper';

export default withNavigationFallback(forwardRef(ScreenWrapper));
export {ScreenWrapperStatusContext};
export type {ScreenWrapperChildrenProps};
