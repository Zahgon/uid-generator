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

import { ReflectionToStringBuilder, SHORT_PREFIX_STYLE } from '../../deps/commons-lang/to-string-builder.js';

/**
 * Entity for M_WORKER_NODE
 *
 * The fields are declared — and therefore created — in the same order as the
 * Java original's, because `toString()` reflects over them and the resulting
 * string is logged.
 *
 * @author yutianbao
 */
export class WorkerNodeEntity {
  /**
   * Entity unique id (table unique)
   */
  private id = 0n;

  /**
   * Type of CONTAINER: HostName, ACTUAL : IP.
   */
  private hostName: string | null = null;

  /**
   * Type of CONTAINER: Port, ACTUAL : Timestamp + Random(0-10000)
   */
  private port: string | null = null;

  /**
   * type of `WorkerNodeType`
   */
  private type = 0;

  /**
   * Worker launch date, default now
   */
  private launchDate: Date | null = new Date();

  /**
   * Created time
   */
  private created: Date | null = null;

  /**
   * Last modified
   */
  private modified: Date | null = null;

  /**
   * Getters & Setters
   */
  getId(): bigint {
    return this.id;
  }

  setId(id: bigint): void {
    this.id = id;
  }

  getHostName(): string | null {
    return this.hostName;
  }

  setHostName(hostName: string | null): void {
    this.hostName = hostName;
  }

  getPort(): string | null {
    return this.port;
  }

  setPort(port: string | null): void {
    this.port = port;
  }

  getType(): number {
    return this.type;
  }

  setType(type: number): void {
    this.type = type;
  }

  getLaunchDate(): Date | null {
    return this.launchDate;
  }

  /** Spelled `setLaunchDateDate` upstream; the name is kept as-is. */
  setLaunchDateDate(launchDate: Date | null): void {
    this.launchDate = launchDate;
  }

  getCreated(): Date | null {
    return this.created;
  }

  setCreated(created: Date | null): void {
    this.created = created;
  }

  getModified(): Date | null {
    return this.modified;
  }

  setModified(modified: Date | null): void {
    this.modified = modified;
  }

  toString(): string {
    return ReflectionToStringBuilder.toString(this, SHORT_PREFIX_STYLE);
  }
}
