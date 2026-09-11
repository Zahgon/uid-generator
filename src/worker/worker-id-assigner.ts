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

/**
 * Represents a worker id assigner for `DefaultUidGenerator`
 *
 * Assigning an id is a database round trip, and every Node database driver is
 * promise-based, so the result is a promise here.
 *
 * @author yutianbao
 */
export interface WorkerIdAssigner {
  /**
   * Assign worker id for `DefaultUidGenerator`
   *
   * @returns assigned worker id
   */
  assignWorkerId(): Promise<bigint>;
}
