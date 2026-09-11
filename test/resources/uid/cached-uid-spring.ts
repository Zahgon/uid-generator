/*
 * Port of `src/test/resources/uid/cached-uid-spring.xml`.
 *
 * The XML leaves every optional property commented out, which means the
 * generator runs on the class defaults — `timeBits=28` with the epoch
 * `2016-05-20`. That combination expired on 2024-11-20 21:24:16, as
 * `DefaultUidGenerator`'s own javadoc says, and after that instant
 * `nextIdsForOneSecond` shifts a 29-bit delta into a 28-bit field and hands out
 * negative ids: running the upstream suite today fails both of this class's
 * tests on `assertTrue(uid > 0L)`.
 *
 * So this fixture carries the bit configuration the upstream README documents
 * for CachedUidGenerator (README, "Step 3: Spring configuration →
 * CachedUidGenerator"), which is the same one `default-uid-spring.xml` already
 * uses and which does not expire until 2033. Nothing about the tests
 * themselves changes. `cached-uid-generator.test.ts` additionally pins the
 * upstream overflow behaviour, so the port is still verified against what the
 * defaults actually do.
 */

import { CachedUidGenerator } from '../../../src/impl/cached-uid-generator.js';
import { createMybatisContext } from './mybatis-spring.js';

export interface CachedUidGeneratorContext {
  readonly uidGenerator: CachedUidGenerator;
  close(): Promise<void>;
}

export async function createCachedUidGeneratorContext(): Promise<CachedUidGeneratorContext> {
  const mybatis = await createMybatisContext();

  const cachedUidGenerator = new CachedUidGenerator();
  cachedUidGenerator.setWorkerIdAssigner(mybatis.disposableWorkerIdAssigner);

  cachedUidGenerator.setTimeBits(29);
  cachedUidGenerator.setWorkerBits(21);
  cachedUidGenerator.setSeqBits(13);
  cachedUidGenerator.setEpochStr('2016-09-20');

  // 以下为可选配置, 如未指定将采用默认值
  // RingBuffer size扩容参数, 可提高UID生成的吞吐量.
  // 默认:3， 原bufferSize=8192, 扩容后bufferSize= 8192 << 3 = 65536
  // cachedUidGenerator.setBoostPower(3);

  // 指定何时向RingBuffer中填充UID, 取值为百分比(0, 100), 默认为50
  // 举例: bufferSize=1024, paddingFactor=50 -> threshold=1024 * 50 / 100 = 512.
  // 当环上可用UID数量 < 512时, 将自动对RingBuffer进行填充补全
  // cachedUidGenerator.setPaddingFactor(50);

  // 另外一种RingBuffer填充时机, 在Schedule线程中, 周期性检查填充
  // 默认:不配置此项, 即不实用Schedule线程. 如需使用, 请指定Schedule线程时间间隔, 单位:秒
  // cachedUidGenerator.setScheduleInterval(60);

  // 拒绝策略: 当环已满, 无法继续填充时
  // 默认无需指定, 将丢弃Put操作, 仅日志记录. 如有特殊需求, 请实现RejectedPutBufferHandler接口
  // cachedUidGenerator.setRejectedPutBufferHandler(xxxxYourPutRejectPolicy);

  // 拒绝策略: 当环已空, 无法继续获取时
  // 默认无需指定, 将记录日志, 并抛出UidGenerateException异常. 如有特殊需求, 请实现RejectedTakeBufferHandler接口
  // cachedUidGenerator.setRejectedTakeBufferHandler(xxxxYourTakeRejectPolicy);

  await cachedUidGenerator.afterPropertiesSet();

  return {
    uidGenerator: cachedUidGenerator,
    close: async () => {
      await cachedUidGenerator.destroy();
      await mybatis.close();
    },
  };
}
