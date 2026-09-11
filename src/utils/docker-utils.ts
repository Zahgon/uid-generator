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

import { StringUtils } from '../deps/commons-lang/string-utils.js';
import { LoggerFactory } from '../deps/slf4j/logger.js';

/**
 * DockerUtils
 *
 * @author yutianbao
 */
const LOGGER = LoggerFactory.getLogger('com.baidu.fsg.uid.utils.DockerUtils');

/** Environment param keys */
const ENV_KEY_HOST = 'JPAAS_HOST';
const ENV_KEY_PORT = 'JPAAS_HTTP_PORT';
const ENV_KEY_PORT_ORIGINAL = 'JPAAS_HOST_PORT_8080';

/** Docker host & port */
let DOCKER_HOST = '';
let DOCKER_PORT = '';

/** Whether is docker */
let IS_DOCKER = false;

/**
 * Retrieve host & port from environment.
 *
 * Java runs this once, in a static initialiser; the module body below is the
 * equivalent, so the environment is read exactly once per process here too.
 */
export function retrieveFromEnv(): void {
  // retrieve host & port from environment
  DOCKER_HOST = process.env[ENV_KEY_HOST] ?? '';
  DOCKER_PORT = process.env[ENV_KEY_PORT] ?? '';

  // not found from 'JPAAS_HTTP_PORT', then try to find from 'JPAAS_HOST_PORT_8080'
  if (StringUtils.isBlank(DOCKER_PORT)) {
    DOCKER_PORT = process.env[ENV_KEY_PORT_ORIGINAL] ?? '';
  }

  const hasEnvHost = StringUtils.isNotBlank(DOCKER_HOST);
  const hasEnvPort = StringUtils.isNotBlank(DOCKER_PORT);

  // docker can find both host & port from environment
  if (hasEnvHost && hasEnvPort) {
    IS_DOCKER = true;

    // found nothing means not a docker, maybe an actual machine
  } else if (!hasEnvHost && !hasEnvPort) {
    IS_DOCKER = false;
  } else {
    LOGGER.error('Missing host or port from env for Docker. host:{}, port:{}', DOCKER_HOST, DOCKER_PORT);
    throw new Error(
      `Missing host or port from env for Docker. host:${DOCKER_HOST}, port:${DOCKER_PORT}`,
    );
  }
}

/**
 * Retrieve docker host
 *
 * @returns empty string if not a docker
 */
export function getDockerHost(): string {
  return DOCKER_HOST;
}

/**
 * Retrieve docker port
 *
 * @returns empty string if not a docker
 */
export function getDockerPort(): string {
  return DOCKER_PORT;
}

/**
 * Whether a docker
 */
export function isDocker(): boolean {
  return IS_DOCKER;
}

retrieveFromEnv();

export const DockerUtils = { getDockerHost, getDockerPort, isDocker, retrieveFromEnv } as const;
