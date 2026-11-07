import Darwin
import UIKit
import os

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        LaunchTiming.didFinishLaunching = LaunchTiming.sinceProcessStart()
        true
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

/// Launch timings from the kernel's process start, logged once the first screen shows content.
/// `didFinishLaunching` includes dyld loading the app's frameworks, such as React Native's.
enum LaunchTiming {
    static var didFinishLaunching: Int?

    /// Milliseconds since the process started, or nil when the kernel does not say.
    static func sinceProcessStart() -> Int? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 else { return nil }
        let start = info.kp_proc.p_un.__p_starttime
        var now = timeval()
        gettimeofday(&now, nil)
        let ms = (Int(now.tv_sec) - Int(start.tv_sec)) * 1000 + (Int(now.tv_usec) - Int(start.tv_usec)) / 1000
        return ms >= 0 ? ms : nil
    }

    static func logFirstContent() {
        let launched = didFinishLaunching.map(String.init) ?? "?"
        let content = sinceProcessStart().map(String.init) ?? "?"
        Navigator.log.notice("launch process->didFinishLaunching=\(launched, privacy: .public)ms process->first-content=\(content, privacy: .public)ms")
    }
}
