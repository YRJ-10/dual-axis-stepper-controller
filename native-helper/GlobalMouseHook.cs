using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

internal static class GlobalMouseHook
{
    private const int WhMouseLl = 14;
    private const int WmRButtonDown = 0x0204;
    private const int WmRButtonUp = 0x0205;
    private const int WmMButtonDown = 0x0207;
    private const int WmMButtonUp = 0x0208;
    private const int WmMouseWheel = 0x020A;

    private static readonly LowLevelMouseProc MouseProc = HookCallback;
    private static IntPtr hookId = IntPtr.Zero;
    private static bool rightButtonHeld;
    private static long rightButtonGraceUntil;
    private static bool middleStopHandled;

    private const int RightButtonGraceMilliseconds = 500;

    public static void Main()
    {
        hookId = SetHook(MouseProc);
        if (hookId == IntPtr.Zero)
        {
            Console.WriteLine("ERROR Unable to install Windows mouse hook");
            Console.Out.Flush();
            Environment.Exit(1);
        }

        Console.WriteLine("READY");
        Console.Out.Flush();

        Message message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }

        UnhookWindowsHookEx(hookId);
    }

    private static IntPtr SetHook(LowLevelMouseProc proc)
    {
        using (Process currentProcess = Process.GetCurrentProcess())
        using (ProcessModule currentModule = currentProcess.MainModule)
        {
            return SetWindowsHookEx(
                WhMouseLl,
                proc,
                GetModuleHandle(currentModule.ModuleName),
                0
            );
        }
    }

    private static IntPtr HookCallback(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            int mouseMessage = message.ToInt32();

            if (mouseMessage == WmRButtonDown)
            {
                rightButtonHeld = true;
                rightButtonGraceUntil = 0;
                return new IntPtr(1);
            }

            if (mouseMessage == WmRButtonUp)
            {
                rightButtonHeld = false;
                rightButtonGraceUntil = Stopwatch.GetTimestamp()
                    + (Stopwatch.Frequency * RightButtonGraceMilliseconds / 1000);
                return new IntPtr(1);
            }

            if (rightButtonHeld && mouseMessage == WmMouseWheel)
            {
                MouseHookData hookData = Marshal.PtrToStructure<MouseHookData>(data);
                short wheelDelta = unchecked((short)((hookData.mouseData >> 16) & 0xffff));
                Console.WriteLine(wheelDelta > 0 ? "SPEED 1" : "SPEED -1");
                Console.Out.Flush();
                return new IntPtr(1);
            }

            if (mouseMessage == WmMButtonDown && IsRightGestureActive())
            {
                EmitStopOnce();
                return new IntPtr(1);
            }

            if (mouseMessage == WmMButtonUp)
            {
                bool consumeMiddleUp = middleStopHandled || IsRightGestureActive();
                if (consumeMiddleUp)
                {
                    EmitStopOnce();
                    middleStopHandled = false;
                    return new IntPtr(1);
                }
                middleStopHandled = false;
            }
        }

        return CallNextHookEx(hookId, code, message, data);
    }

    private static bool IsRightGestureActive()
    {
        return rightButtonHeld || Stopwatch.GetTimestamp() <= rightButtonGraceUntil;
    }

    private static void EmitStopOnce()
    {
        if (middleStopHandled)
        {
            return;
        }
        middleStopHandled = true;
        Console.WriteLine("STOP");
        Console.Out.Flush();
    }

    private delegate IntPtr LowLevelMouseProc(int code, IntPtr message, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseHookData
    {
        public Point point;
        public uint mouseData;
        public uint flags;
        public uint time;
        public UIntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        public IntPtr window;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public Point point;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(
        int hookType,
        LowLevelMouseProc callback,
        IntPtr module,
        uint threadId
    );

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(
        IntPtr hook,
        int code,
        IntPtr message,
        IntPtr data
    );

    [DllImport("user32.dll")]
    private static extern int GetMessage(
        out Message message,
        IntPtr window,
        uint minimumMessage,
        uint maximumMessage
    );

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TranslateMessage(ref Message message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref Message message);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string moduleName);
}
