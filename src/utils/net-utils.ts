/*
 * Copyright (c) 2017 Baidu, Inc. All Rights Reserve.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { networkInterfaces } from 'node:os';

/**
 * NetUtils
 *
 * @author yutianbao
 */

/** One address of one interface, as `NetworkInterface.getInetAddresses()` yields it. */
export interface InetAddress {
  readonly hostAddress: string;
  readonly family: 'IPv4' | 'IPv6';
  getHostAddress(): string;
}

function isLinkLocal(address: string, family: 'IPv4' | 'IPv6'): boolean {
  return family === 'IPv4'
    ? address.startsWith('169.254.')
    : /^fe[89ab][0-9a-f]:/i.test(address);
}

function isLoopback(address: string, family: 'IPv4' | 'IPv6'): boolean {
  return family === 'IPv4' ? address.startsWith('127.') : address === '::1';
}

function isAnyLocal(address: string, family: 'IPv4' | 'IPv6'): boolean {
  return family === 'IPv4' ? address === '0.0.0.0' : address === '::';
}

/**
 * Retrieve the first validated local ip address(the Public and LAN ip addresses are validated).
 *
 * @throws Error when no address qualifies
 */
export function getLocalInetAddress(): InetAddress {
  // enumerates all network interfaces
  for (const addresses of Object.values(networkInterfaces())) {
    if (addresses === undefined) {
      continue;
    }
    // Java skips the whole interface when it is a loopback interface; Node
    // reports the flag per address, and a loopback interface carries only
    // loopback addresses, so the two tests select the same interfaces.
    if (addresses.every((address) => address.internal)) {
      continue;
    }

    for (const address of addresses) {
      const family: 'IPv4' | 'IPv6' = address.family === 'IPv6' ? 'IPv6' : 'IPv4';
      // ignores all invalidated addresses
      if (
        isLinkLocal(address.address, family)
        || isLoopback(address.address, family)
        || isAnyLocal(address.address, family)
      ) {
        continue;
      }

      const hostAddress = address.address;
      return { hostAddress, family, getHostAddress: () => hostAddress };
    }
  }

  throw new Error('No validated local address!');
}

/**
 * Pre-loaded local address.
 *
 * The Java original resolves this in a static initialiser and rethrows a
 * `SocketException` as `RuntimeException("fail to get local ip.")`; an ES module
 * body is the equivalent one-shot initialiser.
 */
export let localAddress: InetAddress;
try {
  localAddress = getLocalInetAddress();
} catch (e) {
  if (e instanceof Error && e.message === 'No validated local address!') {
    throw e;
  }
  throw new Error('fail to get local ip.', { cause: e });
}

/**
 * Retrieve local address
 */
export function getLocalAddress(): string {
  return localAddress.getHostAddress();
}

export const NetUtils = { getLocalInetAddress, getLocalAddress } as const;
