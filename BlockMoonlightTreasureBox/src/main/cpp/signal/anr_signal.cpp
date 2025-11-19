//
// Created by tangxiaolu on 2021/11/2.
//

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
#include <inttypes.h>
#include <errno.h>
#include <signal.h>
#include <sys/syscall.h>
#include <android/log.h>
#include <jni.h>
#include <unistd.h>
#include <pthread.h>
#include <dirent.h>
#include <sys/eventfd.h>
#include <sys/syscall.h>
#include <android/log.h>
#include "xcc_util.h"
#include "anr_signal.h"
#include "bytehook.h"
#include <sstream>
#include <fstream>
#include <sys/socket.h>
#include <sys/system_properties.h>
#define XC_TRACE_CALLBACK_METHOD_NAME         "traceCallback"
#define XC_TRACE_CALLBACK_METHOD_SIGNATURE    "(Ljava/lang/String;Ljava/lang/String;)V"

#define XC_TRACE_SIGNAL_CATCHER_TID_UNLOAD    (-2)
#define XC_TRACE_SIGNAL_CATCHER_TID_UNKNOWN   (-1)
#define XC_TRACE_SIGNAL_CATCHER_THREAD_NAME   "Signal Catcher"
#define XC_TRACE_SIGNAL_CATCHER_THREAD_SIGBLK 0x1000
#define PROP_VALUE_MAX                      92
#define PROP_SDK_NAME                       "ro.build.version.sdk"
#define HOOK_CONNECT_PATH                    "/dev/socket/tombstoned_java_trace"
#define HOOK_OPEN_PATH                       "/data/anr/traces.txt"

static int                              xc_trace_is_lollipop = 0;
static pid_t                            xc_trace_signal_catcher_tid = XC_TRACE_SIGNAL_CATCHER_TID_UNLOAD;

static sigset_t         xcc_signal_trace_oldset;
static struct sigaction xcc_signal_trace_oldact;
//static pid_t         xc_common_process_id;
static bool isHooking = false;
static bool isTraceWrite = false;
static int signalCatcherTid;
static bool fromMyPrintTrace = false;
static std::string anrTracePathString;
static std::string printTracePathString;
static const char *TAG = "AnrMonitor";
bytehook_stub_t open_stub;
bytehook_stub_t connect_stub;
bytehook_stub_t write_stub;
//bytehook_hooked_t open_hooked;
//bytehook_hooked_t connect_hooked;
//bytehook_hooked_t write_hooked;


static void xc_trace_load_signal_catcher_tid()
{
    char           buf[256];
    DIR           *dir;
    struct dirent *ent;
    FILE          *f;
    pid_t          tid;
    uint64_t       sigblk;

    xc_trace_signal_catcher_tid = XC_TRACE_SIGNAL_CATCHER_TID_UNKNOWN;

    snprintf(buf, sizeof(buf), "/proc/%d/task", xc_common_process_id);
    if(nullptr == (dir = opendir(buf))) return;
    while(nullptr != (ent = readdir(dir)))
    {
        //get and check thread id
        if(0 != xcc_util_atoi(ent->d_name, &tid)) continue;
        if(tid < 0) continue;

        //check thread name
        xcc_util_get_thread_name(tid, buf, sizeof(buf));
        if(0 != strcmp(buf, XC_TRACE_SIGNAL_CATCHER_THREAD_NAME)) continue;

        //check signal block masks
        sigblk = 0;
        snprintf(buf, sizeof(buf), "/proc/%d/status", tid);
        if(nullptr == (f = fopen(buf, "r"))) break;
        while(fgets(buf, sizeof(buf), f))
        {
            if(1 == sscanf(buf, "SigBlk: %" SCNx64, &sigblk)) break;
        }
        fclose(f);
        if(XC_TRACE_SIGNAL_CATCHER_THREAD_SIGBLK != sigblk) continue;

        //found it
        xc_trace_signal_catcher_tid = tid;
        break;
    }
    closedir(dir);
}

int getApiLevel() {
    char buf[PROP_VALUE_MAX];
    int len = __system_property_get(PROP_SDK_NAME, buf);
    if (len <= 0)
        return 0;
    return atoi(buf);
}

void xc_trace_send_sigquit()
{
    if(XC_TRACE_SIGNAL_CATCHER_TID_UNLOAD == xc_trace_signal_catcher_tid)
        xc_trace_load_signal_catcher_tid();

    if(xc_trace_signal_catcher_tid >= 0)
        syscall(SYS_tgkill, xc_common_process_id, xc_trace_signal_catcher_tid, SIGQUIT);
}

int block_anr_signal_trace_register(void (*handler)(int, siginfo_t *, void *)){

    int              r;
    sigset_t         set;
    struct sigaction act;

    xc_common_process_id = getpid();
    //un-block the SIGQUIT mask for current thread, hope this is the main thread
    sigemptyset(&set);
    // 添加SIGQUIT信号到这个信号集
    sigaddset(&set, SIGQUIT);
    // 即解除对 SIGQUIT 信号的阻塞，函数返回值 r 不为 0 表示出错。
    if(0 != (r = pthread_sigmask(SIG_UNBLOCK, &set, &xcc_signal_trace_oldset))) return r;

    //register new signal handler for SIGQUIT
    memset(&act, 0, sizeof(act));
    sigfillset(&act.sa_mask);
    // 赋值信号处理器
    act.sa_sigaction = handler;
    // 表示使用信号处理函数时自动重启系统调用，并提供信号附加信息。
    act.sa_flags = SA_RESTART | SA_SIGINFO;
    // 注册信号处理器，函数返回值不为 0 表示出错。
    if(0 != sigaction(SIGQUIT, &act, &xcc_signal_trace_oldact))
    {
        // 如果注册失败，将恢复之前的信号屏蔽字，并返回错误码 -1。
        pthread_sigmask(SIG_SETMASK, &xcc_signal_trace_oldset, nullptr);
        return -1;
//        return XCC_ERRNO_SYS;
    }
    int level = getApiLevel();
    __android_log_print(ANDROID_LOG_INFO, TAG, "API level: %d", level);
    return 0;
}

void block_anr_signal_trace_unregister(void){
    pthread_sigmask(SIG_SETMASK, &xcc_signal_trace_oldset, nullptr);
    sigaction(SIGQUIT, &xcc_signal_trace_oldact, nullptr);
}



void unhook_anr_trace_write() {
    isHooking = false;
    if (nullptr != connect_stub) {
        bytehook_unhook(connect_stub);
        connect_stub = nullptr;
    }
    if (nullptr != open_stub) {
        bytehook_unhook(open_stub);
        open_stub = nullptr;
    }
    if (nullptr != write_stub) {
        bytehook_unhook(write_stub);
        write_stub = nullptr;
    }
}

/**
 * 写入到文件
 * @param content
 * @param filePath
 */
void write_anr(const std::string& content, const std::string &filePath) {
    __android_log_print(ANDROID_LOG_DEBUG, TAG, "write_anr path: %s", filePath.c_str());
    // unhook write
    unhook_anr_trace_write();
    std::string to;
    std::ofstream outfile;
    outfile.open(filePath);
    outfile << content;
}


/**
 * connect 函数代理
 * @param __fd 文件描述符
 * @param __addr  一个用于表示网络套接字地址的结构体 <sys/socket.h>
 * @param __addr_length
 * @return
 */
int my_connect(int __fd, const struct sockaddr* __addr, socklen_t __addr_length) {
    // 执行 stack清理（C++中的写法），不可省略
    BYTEHOOK_STACK_SCOPE();
    if (__addr != nullptr) {
        __android_log_print(ANDROID_LOG_DEBUG, TAG, "my_connect path: %s", __addr->sa_data);
        if (strcmp(__addr->sa_data, HOOK_CONNECT_PATH) == 0) {
            // 保存线程 id
            signalCatcherTid = gettid();
            isTraceWrite = true;
        }
    }
    // 调用原函数并返回结果
    int res = BYTEHOOK_CALL_PREV(my_connect, __fd, __addr, __addr_length);
    return res;
}

/**
 * open 函数代理
 * @param pathname 文件路径
 * @param flags
 * @param mode
 * @return
 */
int my_open(const char *pathname, int flags, mode_t mode) {
    BYTEHOOK_STACK_SCOPE();
    if (pathname != nullptr) {
        __android_log_print(ANDROID_LOG_DEBUG, TAG, "my_open pathname: %s",  pathname);
        if (strcmp(pathname, HOOK_OPEN_PATH) == 0) {
            signalCatcherTid = gettid();
            isTraceWrite = true;
        }
    }
    return BYTEHOOK_CALL_PREV(my_open, pathname, flags, mode);
}

/**
 * write 函数代理
 * @param fd
 * @param buf
 * @param count
 * @return
 */
static ssize_t my_write(int fd, const void* const buf, size_t count) {
    BYTEHOOK_STACK_SCOPE();
    if (isTraceWrite && gettid() == signalCatcherTid) {
        // 确认正在写入trace.txt
        isTraceWrite = false;
        if (buf != nullptr) {
            std::string targetFilePath;
            if (fromMyPrintTrace) {
                targetFilePath = printTracePathString;
            } else {
                targetFilePath = anrTracePathString;
            }
            if (!targetFilePath.empty()) {
                char *content = (char *) buf;
                // 写入到文件
                write_anr(content, targetFilePath);
                if (!fromMyPrintTrace) {
//                    anrDumpTraceCallback();
                } else {
//                    printTraceCallback();
                }
                fromMyPrintTrace = false;
            }
        }
    }
    return BYTEHOOK_CALL_PREV(my_write, fd, buf, count);
}

/**
 * hook系统对data/anr/trace.txt的写入
 */
void hook_anr_trace_write(bool isSigUser) {
    __android_log_print(ANDROID_LOG_DEBUG, TAG, "hook_anr_trace_write anrTracePathString: %s", anrTracePathString.c_str());
    if (anrTracePathString.empty() || printTracePathString.empty()) {
        return;
    }

    int apiLevel = getApiLevel();
    __android_log_print(ANDROID_LOG_DEBUG, TAG, "hook_anr_trace_write apiLevel: %d", apiLevel);
    if (apiLevel < 19) {
        return;
    }
    if (isHooking) {
        return;
    }
    isHooking = true;

    if (apiLevel >= 27) {
        // hook connect
        connect_stub = bytehook_hook_single("libcutils.so", nullptr, "connect", (void *) my_connect, nullptr, nullptr);
    } else {
        // hook open
        open_stub = bytehook_hook_single( "libart.so", nullptr, "open", (void *) my_open, nullptr, nullptr);
    }
    // //返回NULL表示添加任务失败，否则为成功。
    //bytehook_stub_t bytehook_hook_single(
    //    const char *caller_path_name, //调用者的pathname或basename（不可为NULL）
    //    const char *callee_path_name, //被调用者的pathname
    //    const char *sym_name, //需要hook的函数名（不可为NULL）
    //    void *new_func, //新函数（不可为NULL）
    //    bytehook_hooked_t hooked, //hook后的回调函数
    //    void *hooked_arg); //回调函数的自定义参数
    if (apiLevel >= 30 || apiLevel == 25 || apiLevel == 24) {
        write_stub = bytehook_hook_single("libc.so", nullptr, "write", (void *) my_write, nullptr, nullptr);
    } else if (apiLevel == 29) {
        write_stub = bytehook_hook_single("libbase.so", nullptr, "write", (void *) my_write, nullptr, nullptr);
    } else {
        write_stub = bytehook_hook_single("libart.so", nullptr, "write", (void *) my_write, nullptr, nullptr);
    }
    __android_log_print(ANDROID_LOG_DEBUG, TAG, "hook_anr_trace_write connect_stub: %p write_stub: %p", connect_stub, write_stub);
}

void native_init_signal_anr_detective(JNIEnv *env, jstring anrTracePath, jstring printTracePath) {

    if (anrTracePath != nullptr) {
        anrTracePathString = env->GetStringUTFChars(anrTracePath, nullptr);
    }
    if (printTracePath != nullptr) {
        printTracePathString = env->GetStringUTFChars(printTracePath, nullptr);
    }
}




