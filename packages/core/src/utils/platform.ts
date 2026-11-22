import type { DevicePlatform } from '../contracts/sync.ts';
import type { PlatformRuntime } from '../types/music.ts';

export function mapRuntimeToDevicePlatform(runtime: PlatformRuntime): DevicePlatform {
  switch (runtime) {
    case 'electron':
      return 'windows';
    case 'android':
      return 'android';
    case 'web':
      return 'web';
  }
}
