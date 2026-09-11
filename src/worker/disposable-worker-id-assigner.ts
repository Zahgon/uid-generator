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

import { RandomUtils } from '../deps/commons-lang/random-utils.js';
import { LoggerFactory } from '../deps/slf4j/logger.js';
import { DockerUtils } from '../utils/docker-utils.js';
import { NetUtils } from '../utils/net-utils.js';
import type { WorkerNodeDAO } from './dao/worker-node-dao.js';
import { WorkerNodeEntity } from './entity/worker-node-entity.js';
import type { WorkerIdAssigner } from './worker-id-assigner.js';
import { WorkerNodeType } from './worker-node-type.js';

/**
 * Represents an implementation of `WorkerIdAssigner`,
 * the worker id will be discarded after assigned to the UidGenerator
 *
 * @author yutianbao
 */
const LOGGER = LoggerFactory.getLogger('com.baidu.fsg.uid.worker.DisposableWorkerIdAssigner');

export class DisposableWorkerIdAssigner implements WorkerIdAssigner {
  private readonly workerNodeDAO: WorkerNodeDAO;

  constructor(workerNodeDAO: WorkerNodeDAO) {
    this.workerNodeDAO = workerNodeDAO;
  }

  /**
   * Assign worker id base on database.
   * If there is host name & port in the environment, we considered that the node runs in Docker container
   * Otherwise, the node runs on an actual machine.
   *
   * Transactional upstream: the insert and the generated-key read-back are one
   * unit of work.
   *
   * @returns assigned worker id
   */
  async assignWorkerId(): Promise<bigint> {
    // build worker node entity
    const workerNodeEntity = this.buildWorkerNode();

    // add worker node for new (ignore the same IP + PORT)
    await this.workerNodeDAO.addWorkerNode(workerNodeEntity);
    LOGGER.info(`Add worker node:${workerNodeEntity.toString()}`);

    return workerNodeEntity.getId();
  }

  /**
   * Build worker node entity by IP and PORT
   */
  private buildWorkerNode(): WorkerNodeEntity {
    const workerNodeEntity = new WorkerNodeEntity();
    if (DockerUtils.isDocker()) {
      workerNodeEntity.setType(WorkerNodeType.CONTAINER.value());
      workerNodeEntity.setHostName(DockerUtils.getDockerHost());
      workerNodeEntity.setPort(DockerUtils.getDockerPort());
    } else {
      workerNodeEntity.setType(WorkerNodeType.ACTUAL.value());
      workerNodeEntity.setHostName(NetUtils.getLocalAddress());
      workerNodeEntity.setPort(`${String(Date.now())}-${String(RandomUtils.nextInt(100000))}`);
    }

    return workerNodeEntity;
  }
}
