export function testGamepad() {
  return {
    id: 'wheel', index: 0, connected: true, mapping: 'standard' as const, timestamp: 0,
    axes: [0],
    buttons: Array.from({ length: 8 }, () => ({ value: 0, pressed: false, touched: false })),
    vibrationActuator: {
      playEffect: async () => 'complete' as const,
      reset: async () => 'complete' as const,
      pulse: async () => true,
    },
    hapticActuators: [],
  };
}
