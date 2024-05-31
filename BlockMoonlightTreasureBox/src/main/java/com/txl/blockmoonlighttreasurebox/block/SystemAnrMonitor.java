package com.txl.blockmoonlighttreasurebox.block;

import com.bytedance.android.bytehook.ByteHook;

public class SystemAnrMonitor {
    static {
        System.loadLibrary("block_signal");
    }
    private native void hookSignalCatcher(ISystemAnrObserver observed, String anrTracePath, String printTracePath);
    private native void unHookSignalCatcher();

    public static void init(ISystemAnrObserver systemAnrObserver, String anrTracePath, String printTracePath){
        new SystemAnrMonitor().hookSignalCatcher(systemAnrObserver, anrTracePath, printTracePath);
        // init byte hook
        ByteHook.init();
    }
}
