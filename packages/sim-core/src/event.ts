/**
 * Shape every simulation event extends: a string-literal `type` and the `frame` being processed
 * when it occurred (the input state's `frame`). Events are plain, serializable and readonly.
 */
export interface SimulationEventEnvelope<TType extends string> {
  readonly type: TType;
  readonly frame: number;
}
