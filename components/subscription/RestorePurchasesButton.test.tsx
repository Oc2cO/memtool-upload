import React from "react";
import { Pressable } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

import { RestorePurchasesButton } from "./RestorePurchasesButton";

const baseProps = {
  onPress: () => {},
  disabled: false,
  textColor: "#888",
  containerStyle: {},
  textStyle: {},
  PressComponent: Pressable,
};

describe("RestorePurchasesButton — visibility contract", () => {
  test("renders on the Apple rail when the user is not Pro", () => {
    const view = render(
      <RestorePurchasesButton {...baseProps} isApple={true} isPro={false} />,
    );
    expect(view.getByLabelText("Restore purchases")).toBeTruthy();
    expect(view.getByText("Restore purchases")).toBeTruthy();
  });

  test("hides on the Stripe rail (Apple-only affordance)", () => {
    const view = render(
      <RestorePurchasesButton {...baseProps} isApple={false} isPro={false} />,
    );
    expect(view.queryByLabelText("Restore purchases")).toBeNull();
  });

  test("hides when the user is already Pro", () => {
    const view = render(
      <RestorePurchasesButton {...baseProps} isApple={true} isPro={true} />,
    );
    expect(view.queryByLabelText("Restore purchases")).toBeNull();
  });

  test("disabled prop dims but keeps the button rendered", () => {
    const view = render(
      <RestorePurchasesButton
        {...baseProps}
        isApple={true}
        isPro={false}
        disabled={true}
      />,
    );
    expect(view.getByLabelText("Restore purchases")).toBeTruthy();
    expect(view.getByText("Restore purchases")).toBeTruthy();
  });

  test("press fires through to the injected onPress handler", () => {
    const onPress = jest.fn();
    const view = render(
      <RestorePurchasesButton
        {...baseProps}
        isApple={true}
        isPro={false}
        onPress={onPress}
      />,
    );
    fireEvent.press(view.getByLabelText("Restore purchases"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("disabled button does not invoke onPress when pressed", () => {
    const onPress = jest.fn();
    const view = render(
      <RestorePurchasesButton
        {...baseProps}
        isApple={true}
        isPro={false}
        disabled={true}
        onPress={onPress}
      />,
    );
    fireEvent.press(view.getByLabelText("Restore purchases"));
    expect(onPress).not.toHaveBeenCalled();
  });
});
