import { LinearTransition, ReduceMotion } from "react-native-reanimated";

export const THREAD_LIST_ROW_LAYOUT = LinearTransition.springify()
  .damping(26)
  .stiffness(340)
  .mass(0.75)
  .reduceMotion(ReduceMotion.System);
