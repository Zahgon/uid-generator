/*
 * Port of `src/test/resources/uid/default-uid-spring.xml`.
 *
 *   <bean id="defaultUidGenerator" class="…DefaultUidGenerator" lazy-init="false">
 *     <property name="workerIdAssigner" ref="disposableWorkerIdAssigner"/>
 *     <property name="timeBits"   value="29"/>
 *     <property name="workerBits" value="21"/>
 *     <property name="seqBits"    value="13"/>
 *     <property name="epochStr"   value="2016-09-20"/>
 *   </bean>
 */

import { DefaultUidGenerator } from '../../../src/impl/default-uid-generator.js';
import type { UidGenerator } from '../../../src/uid-generator.js';
import { createMybatisContext } from './mybatis-spring.js';

export interface UidGeneratorContext {
  readonly uidGenerator: UidGenerator;
  close(): Promise<void>;
}

export async function createDefaultUidGeneratorContext(): Promise<UidGeneratorContext> {
  const mybatis = await createMybatisContext();

  const defaultUidGenerator = new DefaultUidGenerator();
  defaultUidGenerator.setWorkerIdAssigner(mybatis.disposableWorkerIdAssigner);

  // Specified bits & epoch as your demand. No specified the default value will be used
  defaultUidGenerator.setTimeBits(29);
  defaultUidGenerator.setWorkerBits(21);
  defaultUidGenerator.setSeqBits(13);
  defaultUidGenerator.setEpochStr('2016-09-20');

  // lazy-init="false"
  await defaultUidGenerator.afterPropertiesSet();

  return {
    uidGenerator: defaultUidGenerator,
    close: () => mybatis.close(),
  };
}
