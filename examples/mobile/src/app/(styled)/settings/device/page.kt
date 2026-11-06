// The Android platform screen for /settings/device (module id app/settings/device).
// Farm records it in farm-routes.json as screen "platform"; it does not compile page.kt into the
// shell yet, so the app shows a placeholder for this route. Web builds never read this file.
package app.settings.device

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun DeviceScreen() {
    Text("Device settings")
}
