import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { create } from 'zustand';

export const useNetwork = create<{ online: boolean }>(() => ({ online: true }));

let started = false;

/** Wire NetInfo into both the UI and TanStack Query (which pauses requests while offline). */
export function startNetworkMonitoring() {
  if (started) return;
  started = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      useNetwork.setState({ online });
      setOnline(online);
    }),
  );
}
