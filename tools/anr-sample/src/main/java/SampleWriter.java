import com.txl.blockmoonlighttreasurebox.info.AnrInfo;
import com.txl.blockmoonlighttreasurebox.info.BoxMessage;
import com.txl.blockmoonlighttreasurebox.info.MessageInfo;
import com.txl.blockmoonlighttreasurebox.info.ScheduledInfo;

import java.io.FileOutputStream;
import java.io.ObjectOutputStream;

public class SampleWriter {
    public static void main(String[] args) throws Exception {
        AnrInfo info = new AnrInfo();
        info.markTime = "2025-11-19 12:00:00:000";
        info.mainThreadStack = "com.example.MainActivity\n  at something";
        info.cpuInfo = "Cpu usage";
        info.systemLoad = "Load avg";
        info.messageQueueSample.append("when:-10 msg sample\n");

        MessageInfo normal = new MessageInfo();
        normal.msgType = MessageInfo.MSG_TYPE_INFO;
        normal.wallTime = 50;
        normal.cpuTime = 20;
        BoxMessage box1 = new BoxMessage("android.os.Handler", "MainActivity$1", 0, "0x123");
        box1.setMsgId(91);
        normal.boxMessages.add(box1);
        info.messageSamplerCache.put(1L, normal);

        MessageInfo warn = new MessageInfo();
        warn.msgType = MessageInfo.MSG_TYPE_WARN;
        warn.wallTime = 355;
        warn.cpuTime = 100;
        BoxMessage box2 = new BoxMessage("android.os.Handler", "MainActivity$2", 0, "0x124");
        box2.setMsgId(93);
        warn.boxMessages.add(box2);
        info.messageSamplerCache.put(2L, warn);

        MessageInfo anr = new MessageInfo();
        anr.msgType = MessageInfo.MSG_TYPE_ANR;
        anr.wallTime = 3277;
        anr.cpuTime = 120;
        BoxMessage box3 = new BoxMessage("android.os.Handler", "MainActivity$3", 0, "0x125");
        box3.setMsgId(98);
        anr.boxMessages.add(box3);
        info.messageSamplerCache.put(3L, anr);

        ScheduledInfo scheduling1 = new ScheduledInfo(44, "msg-91", true);
        ScheduledInfo scheduling2 = new ScheduledInfo(2166, "msg-93", true);
        ScheduledInfo scheduling3 = new ScheduledInfo(3277, "msg-98", true);

        info.scheduledSamplerCache.put(1L, scheduling1);
        info.scheduledSamplerCache.put(2L, scheduling2);
        info.scheduledSamplerCache.put(3L, scheduling3);

        try (ObjectOutputStream oos = new ObjectOutputStream(new FileOutputStream("sample.anr"))) {
            oos.writeObject(info);
        }
    }
}
