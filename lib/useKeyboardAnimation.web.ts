import { useSharedValue } from "react-native-reanimated";

export function useKeyboardAnimation() {
  const progress = useSharedValue(0);
  return { progress };
}
