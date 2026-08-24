// This file is kept as a re-export barrel for backward compatibility.
// The actual implementation is split across:
//   ./rosterStore.ts     — types, context, reducer, hook (non-component)
//   ./RosterProvider.tsx — RosterProvider component only

export * from './rosterStore';
export { RosterProvider } from './RosterProvider';
