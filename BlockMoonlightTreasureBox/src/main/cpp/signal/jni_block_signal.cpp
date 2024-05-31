//
// Created by tangxiaolu on 2021/11/2.
//

#include <jni.h>
#include <string>
#include <jni.h>
#include "anr_signal.h"
#include <unistd.h>
#include <pthread.h>


bool is_registered;
jobject system_anr_observed;

JNIEnv *glb_env;

static void notify_system_anr() {
    if (glb_env == nullptr || system_anr_observed == nullptr) {
        return;
    }
    jclass obj_class = glb_env->GetObjectClass(system_anr_observed);

    jmethodID getName_method = glb_env->GetMethodID(obj_class, "onSystemAnr", "()V");

    glb_env->CallVoidMethod(system_anr_observed, getName_method);
}

/**
 * 系统发来的信号
 * @param arg
 * @return
 */
static void *anrCallback(void* arg) {
    hook_anr_trace_write(false);
    xc_trace_send_sigquit();
    return nullptr;
}

/**
 * 调试发来的信号
 * @param arg
 * @return
 */
static void *siUserCallback(void* arg) {
    hook_anr_trace_write(true);
    xc_trace_send_sigquit();
    return nullptr;
}

/**
 * 收到信号回调
 * @param sig
 * @param si
 * @param uc
 */
static void xc_trace_handler(int sig, siginfo_t *si, void *uc) {
    int fromPid1 = si->_si_pad[3];
    int fromPid2 = si->_si_pad[4];
    int myPid = getpid();
    bool fromMySelf = fromPid1 == myPid || fromPid2 == myPid;
    if (sig == SIGQUIT) {
        notify_system_anr();
        // 子线程hook write 重发信号给SignalCatcher
        pthread_t thd;
        if (fromMySelf) {
            pthread_create(&thd, nullptr, siUserCallback, nullptr);
        } else {
            pthread_create(&thd, nullptr, anrCallback, nullptr);
        }
        pthread_detach(thd);
    }
}


extern "C"
JNIEXPORT void JNICALL
Java_com_txl_blockmoonlighttreasurebox_block_SystemAnrMonitor_hookSignalCatcher(JNIEnv *env,
                                                                                jobject thiz,
                                                                                jobject observed,
                                                                                jstring anrTracePath,
                                                                                jstring printTracePath
) {
    if (!is_registered) {
        glb_env = env;
        is_registered = true;
        system_anr_observed = env->NewGlobalRef(observed);
        block_anr_signal_trace_register(xc_trace_handler);
        native_init_signal_anr_detective(env, anrTracePath, printTracePath);
    }
}


extern "C"
JNIEXPORT void JNICALL
Java_com_txl_blockmoonlighttreasurebox_block_SystemAnrMonitor_unHookSignalCatcher(JNIEnv *env,
                                                                                  jobject thiz) {
    if (system_anr_observed != nullptr) {
        env->DeleteGlobalRef(system_anr_observed);
        is_registered = false;
        block_anr_signal_trace_unregister();
    }
}