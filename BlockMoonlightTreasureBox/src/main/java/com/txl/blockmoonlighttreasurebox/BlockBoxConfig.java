package com.txl.blockmoonlighttreasurebox;

import com.txl.blockmoonlighttreasurebox.loghandle.IBoxInfoHandle;

public class BlockBoxConfig {
    /**
     * 超过这个时间输出警告 超过这个时间消息单独罗列出来
     */
    private long warnTime = 300;
    //这个值暂定50ms
    private long gapTime = 50;
    /**
     * 超过这个时间可直接判定为anr
     */
    private long anrTime = 3000;
    /**
     * 三大流程掉帧数 超过这个值判定为jank
     */
    private int jankFrame = 30;

    private IBoxInfoHandle boxInfoHandle;


    public long getWarnTime() {
        return warnTime;
    }

    public long getGapTime() {
        return gapTime;
    }

    public long getAnrTime() {
        return anrTime;
    }

    public int getJankFrame() {
        return jankFrame;
    }

    private BlockBoxConfig() {
    }

    public IBoxInfoHandle getBoxInfoHandle() {
        return boxInfoHandle;
    }



    public static class Builder{
        private final BlockBoxConfig config;
        public Builder(){
            config = new BlockBoxConfig();
        }

        public Builder setWarnTime(long warnTime) {
            config.warnTime = warnTime;
            return this;
        }

        public Builder setGapTime(long gapTime) {
            config.gapTime = gapTime;
            return this;
        }

        public Builder setAnrTime(long anrTime) {
            config.anrTime = anrTime;
            return this;
        }

        public Builder setJankFrame(int jankFrme) {
            config.jankFrame = jankFrme;
            return this;
        }

        public Builder setBoxInfoHandle(IBoxInfoHandle boxInfoHandle) {
            config.boxInfoHandle = boxInfoHandle;
            return this;
        }

        public BlockBoxConfig build(){
            return config;
        }
    }
}
