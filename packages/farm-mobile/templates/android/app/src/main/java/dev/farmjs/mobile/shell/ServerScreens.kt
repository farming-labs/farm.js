package dev.farmjs.mobile.shell

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextPaint
import android.text.method.LinkMovementMethod
import android.text.style.AbsoluteSizeSpan
import android.text.style.ClickableSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.text.style.UnderlineSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.webkit.CookieManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * Screens whose rule is `"server"`: the analyzer proved the page needs no JavaScript, so the
 * server renders it as for a browser and answers with a tree of views (`native-tree.ts`), which
 * this draws with plain Android views. Anything it cannot draw, a failed request, or a response
 * that is not a tree (a redirect to sign in, say) shows the route's web screen instead.
 */
object FarmServerScreens {
    const val CONTENT_TYPE = "application/vnd.farm.native+json"
    private val network = Executors.newFixedThreadPool(4)
    private val main = Handler(Looper.getMainLooper())

    fun open(context: Context, host: FarmNativeHost, url: Uri): FarmNativeContent {
        val frame = FrameLayout(context)
        val spinner = ProgressBar(context)
        frame.addView(spinner, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        var closed = false
        network.execute {
            val result = runCatching { fetch(url) }
            main.post {
                if (closed) return@post
                result.fold(
                    onSuccess = { tree ->
                        val unsupported = tree.optJSONArray("unsupported")
                        if (unsupported != null && unsupported.length() > 0) {
                            host.fallback("the tree cannot express ${unsupported.join(", ")}")
                            return@fold
                        }
                        runCatching { Renderer(context, host, url).screen(tree.getJSONObject("root")) }
                            .onSuccess { view ->
                                frame.removeView(spinner)
                                frame.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                                tree.optString("title").takeIf { it.isNotEmpty() }?.let(host::setTitle)
                                host.rendered()
                            }
                            .onFailure { host.fallback(it.message ?: it.toString()) }
                    },
                    onFailure = { host.fallback(it.message ?: it.toString()) },
                )
            }
        }
        return FarmNativeContent(frame, title = "", close = { closed = true })
    }

    /** The page's tree, with the WebViews' cookies, so a signed-in page renders signed in. */
    private fun fetch(url: Uri): JSONObject {
        val connection = URL(url.toString()).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("Accept", CONTENT_TYPE)
            CookieManager.getInstance().getCookie(url.toString())?.let { connection.setRequestProperty("Cookie", it) }
            val status = connection.responseCode
            connection.headerFields["Set-Cookie"]?.forEach { CookieManager.getInstance().setCookie(url.toString(), it) }
            val type = connection.contentType.orEmpty()
            if (status != 200 || !type.startsWith(CONTENT_TYPE)) error("the server answered $status $type")
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }

    /** Images, loaded off the main thread with the same cookies. */
    fun loadImage(view: ImageView, src: String) {
        network.execute {
            val bitmap: Bitmap? = runCatching {
                val connection = URL(src).openConnection() as HttpURLConnection
                CookieManager.getInstance().getCookie(src)?.let { connection.setRequestProperty("Cookie", it) }
                try {
                    connection.inputStream.use(BitmapFactory::decodeStream)
                } finally {
                    connection.disconnect()
                }
            }.getOrNull()
            if (bitmap != null) main.post { view.setImageBitmap(bitmap) }
        }
    }
}

private fun JSONArray.join(separator: String): String = (0 until length()).joinToString(separator) { optString(it) }

/** One tree into views. Lengths in the tree are CSS px, drawn as dp. */
private class Renderer(private val context: Context, private val host: FarmNativeHost, private val page: Uri) {
    private val density = context.resources.displayMetrics.density
    private val dark = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    private val defaultText = ContextCompat.getColor(context, R.color.farm_text)

    fun screen(root: JSONObject): View {
        val scroll = ScrollView(context).apply { isFillViewport = true }
        val view = node(root, parentRow = false) ?: View(context)
        scroll.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        return scroll
    }

    private fun px(value: Double): Int = (value * density).roundToInt()

    /** The node's style, with its `dark:` overrides in dark mode. */
    private fun style(node: JSONObject): JSONObject {
        val style = node.optJSONObject("style") ?: JSONObject()
        if (!dark) return style
        val overrides = node.optJSONObject("dark") ?: return style
        val merged = JSONObject(style.toString())
        overrides.keys().forEach { merged.put(it, overrides.get(it)) }
        return merged
    }

    private fun color(value: String?): Int? {
        if (value == null || value == "currentColor") return null
        if (value == "transparent") return Color.TRANSPARENT
        val hex = value.removePrefix("#")
        val argb = when (hex.length) {
            3 -> "ff" + hex.map { "$it$it" }.joinToString("")
            4 -> hex.substring(3).repeat(2) + hex.substring(0, 3).map { "$it$it" }.joinToString("")
            6 -> "ff$hex"
            8 -> hex.substring(6) + hex.substring(0, 6)
            else -> error("color $value")
        }
        return argb.toLong(16).toInt()
    }

    private fun length(style: JSONObject, key: String): Int? = style.opt(key).let { value ->
        when (value) {
            is Number -> px(value.toDouble())
            "100%" -> ViewGroup.LayoutParams.MATCH_PARENT
            null, "auto" -> null
            else -> error("$key $value")
        }
    }

    private fun node(node: JSONObject, parentRow: Boolean): View? {
        val style = style(node)
        if (style.optString("display") == "none") return null
        val type = node.getString("type")
        val view = when (type) {
            "Text" -> text(node, style)
            "Image" -> ImageView(context).apply {
                val sized = style.has("width") && style.has("height")
                scaleType = if (sized) ImageView.ScaleType.CENTER_CROP else ImageView.ScaleType.FIT_CENTER
                adjustViewBounds = !sized
                contentDescription = node.optString("alt").ifEmpty { null }
                node.optString("src").takeIf { it.isNotEmpty() }?.let { FarmServerScreens.loadImage(this, it) }
            }
            "TextInput" -> EditText(context).apply {
                hint = node.optString("placeholder").ifEmpty { null }
                setText(node.optString("value"))
                textStyle(this, style)
            }
            "View", "Pressable" -> box(node, style)
            else -> error("node $type")
        }
        decorate(view, style)
        if (type == "Pressable") {
            node.optString("href").takeIf { it.isNotEmpty() }?.let { href ->
                view.isClickable = true
                view.setOnClickListener { host.visit(Uri.parse(href), replace = false) }
            }
            val ripple = TypedValue()
            context.theme.resolveAttribute(android.R.attr.selectableItemBackground, ripple, true)
            view.foreground = ContextCompat.getDrawable(context, ripple.resourceId)
        }
        view.layoutParams = layout(style, parentRow)
        return view
    }

    private fun box(node: JSONObject, style: JSONObject): View {
        val row = style.optString("flexDirection") == "row"
        if (row && style.optString("flexWrap") == "wrap") return flow(node, style)
        val box = BoxLayout(context).apply {
            orientation = if (row) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            maxWidth = length(style, "maxWidth")?.takeIf { it > 0 }
            maxHeight = length(style, "maxHeight")?.takeIf { it > 0 }
        }
        val gap = px(if (row) style.optDouble("columnGap", 0.0) else style.optDouble("rowGap", 0.0))
        val justify = style.optString("justifyContent")
        val align = style.optString("alignItems").ifEmpty { "stretch" }
        box.gravity = when (justify) {
            "center" -> if (row) Gravity.CENTER_HORIZONTAL else Gravity.CENTER_VERTICAL
            "flex-end" -> if (row) Gravity.END else Gravity.BOTTOM
            else -> if (row) Gravity.START else Gravity.TOP
        }
        // space-around and space-evenly are drawn as space-between.
        val between = justify == "space-between" || justify == "space-around" || justify == "space-evenly"
        val children = node.optJSONArray("children") ?: JSONArray()
        var index = 0
        for (position in 0 until children.length()) {
            val childNode = children.optJSONObject(position) ?: continue
            val child = node(childNode, row) ?: continue
            val childStyle = style(childNode)
            val params = child.layoutParams as LinearLayout.LayoutParams
            when (val self = childStyle.optString("alignSelf").ifEmpty { align }) {
                // The default, as on the web: fill the cross axis unless the child sets its size.
                "stretch" -> if (row) {
                    if (!childStyle.has("height")) params.height = ViewGroup.LayoutParams.MATCH_PARENT
                } else if (!childStyle.has("width")) {
                    params.width = ViewGroup.LayoutParams.MATCH_PARENT
                }
                else -> params.gravity = when (self) {
                    "center" -> if (row) Gravity.CENTER_VERTICAL else Gravity.CENTER_HORIZONTAL
                    "flex-end" -> if (row) Gravity.BOTTOM else Gravity.END
                    else -> if (row) Gravity.TOP else Gravity.START
                }
            }
            if (index > 0) {
                if (between) box.addView(View(context), LinearLayout.LayoutParams(0, 0, 1f))
                if (row) params.marginStart += gap else params.topMargin += gap
            }
            box.addView(child, params)
            index += 1
        }
        return box
    }

    /** `flex-wrap: wrap` in a row: items flow left to right and wrap, with the gaps between. */
    private fun flow(node: JSONObject, style: JSONObject): View {
        val flow = FlowLayout(
            context,
            columnGap = px(style.optDouble("columnGap", 0.0)),
            rowGap = px(style.optDouble("rowGap", 0.0)),
            centerItems = style.optString("alignItems") == "center",
        )
        val children = node.optJSONArray("children") ?: JSONArray()
        for (position in 0 until children.length()) {
            val childNode = children.optJSONObject(position) ?: continue
            val child = node(childNode, parentRow = true) ?: continue
            flow.addView(child, child.layoutParams)
        }
        return flow
    }

    private fun layout(style: JSONObject, parentRow: Boolean): LinearLayout.LayoutParams {
        val params = LinearLayout.LayoutParams(
            length(style, "width") ?: ViewGroup.LayoutParams.WRAP_CONTENT,
            length(style, "height") ?: ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        val grow = style.optDouble("flexGrow", 0.0)
        if (grow > 0) {
            params.weight = grow.toFloat()
            if (parentRow) params.width = 0 else params.height = 0
        }
        // `mx-auto`: centered on the cross axis of a column.
        if (style.opt("marginLeft") == "auto" && style.opt("marginRight") == "auto") {
            params.gravity = Gravity.CENTER_HORIZONTAL
        }
        params.marginStart = length(style, "marginLeft") ?: 0
        params.marginEnd = length(style, "marginRight") ?: 0
        params.topMargin = length(style, "marginTop") ?: 0
        params.bottomMargin = length(style, "marginBottom") ?: 0
        return params
    }

    /** Padding, background, border, radius, opacity, clipping, and minimum sizes. */
    private fun decorate(view: View, style: JSONObject) {
        view.setPadding(
            length(style, "paddingLeft") ?: view.paddingLeft,
            length(style, "paddingTop") ?: view.paddingTop,
            length(style, "paddingRight") ?: view.paddingRight,
            length(style, "paddingBottom") ?: view.paddingBottom,
        )
        length(style, "minWidth")?.let { view.minimumWidth = it }
        length(style, "minHeight")?.let { view.minimumHeight = it }
        if (style.has("opacity")) view.alpha = style.optDouble("opacity", 1.0).toFloat()
        background(style)?.let { view.background = it }
        val radius = style.optDouble("borderTopLeftRadius", 0.0)
        // `overflow-hidden` clips children; an image with a radius is clipped to it, as on the web.
        if (style.optString("overflow") == "hidden" || (view is ImageView && radius > 0)) {
            view.clipToOutline = true
            view.outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(target: View, outline: Outline) {
                    outline.setRoundRect(0, 0, target.width, target.height, px(radius).toFloat())
                }
            }
            (view as? ViewGroup)?.clipChildren = true
        }
    }

    private fun background(style: JSONObject): Drawable? {
        val fill = color(style.optString("backgroundColor").ifEmpty { null })
        val sides = listOf("Top", "Right", "Bottom", "Left").map { side ->
            px(style.optDouble("border${side}Width", 0.0)) to
                (color(style.optString("border${side}Color").ifEmpty { null }) ?: defaultText)
        }
        val radii = listOf("TopLeft", "TopRight", "BottomRight", "BottomLeft").flatMap { corner ->
            val radius = px(style.optDouble("border${corner}Radius", 0.0)).toFloat()
            listOf(radius, radius)
        }.toFloatArray()
        if (fill == null && sides.all { it.first == 0 } && radii.all { it == 0f }) return null
        val shape = GradientDrawable().apply {
            cornerRadii = radii
            setColor(fill ?: Color.TRANSPARENT)
        }
        val widths = sides.map { it.first }.toSet()
        if (sides.all { it.first == sides[0].first && it.second == sides[0].second }) {
            if (sides[0].first > 0) shape.setStroke(sides[0].first, sides[0].second)
            return shape
        }
        if (widths.size > 2 || sides.filter { it.first > 0 }.map { it.second }.toSet().size > 1) {
            error("borders of different widths or colors")
        }
        // One width on some sides: a stroked layer pushed out past the sides without a border.
        val width = sides.maxOf { it.first }
        val stroke = GradientDrawable().apply {
            cornerRadii = radii
            setStroke(width, sides.first { it.first > 0 }.second)
            setColor(fill ?: Color.TRANSPARENT)
        }
        val layers = LayerDrawable(arrayOf(stroke))
        val (top, right, bottom, left) = sides.map { if (it.first > 0) 0 else -width }
        layers.setLayerInset(0, left, top, right, bottom)
        return layers
    }

    private fun text(node: JSONObject, style: JSONObject): TextView {
        val view = TextView(context)
        textStyle(view, style)
        val content = SpannableStringBuilder()
        runs(node.optJSONArray("children") ?: JSONArray(), content, style.optString("textTransform"))
        view.text = content
        if (content.getSpans(0, content.length, ClickableSpan::class.java).isNotEmpty()) {
            view.movementMethod = LinkMovementMethod.getInstance()
        }
        return view
    }

    private fun textStyle(view: TextView, style: JSONObject) {
        view.setTextColor(color(style.optString("color").ifEmpty { null }) ?: defaultText)
        val size = style.optDouble("fontSize", 16.0)
        view.setTextSize(TypedValue.COMPLEX_UNIT_DIP, size.toFloat())
        if (style.has("lineHeight") && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            view.lineHeight = px(style.optDouble("lineHeight"))
        }
        if (style.has("letterSpacing")) view.letterSpacing = style.optDouble("letterSpacing").toFloat()
        view.typeface = typeface(style)
        view.gravity = when (style.optString("textAlign")) {
            "center" -> Gravity.CENTER_HORIZONTAL
            "right" -> Gravity.END
            else -> Gravity.START
        }
        val decoration = style.optString("textDecorationLine")
        view.paintFlags = when (decoration) {
            "underline" -> view.paintFlags or android.graphics.Paint.UNDERLINE_TEXT_FLAG
            "line-through" -> view.paintFlags or android.graphics.Paint.STRIKE_THRU_TEXT_FLAG
            else -> view.paintFlags
        }
    }

    private fun typeface(style: JSONObject): Typeface {
        val family = when (style.optString("fontFamily")) {
            "mono" -> Typeface.MONOSPACE
            "serif" -> Typeface.SERIF
            else -> Typeface.SANS_SERIF
        }
        val weight = style.optInt("fontWeight", 400)
        val italic = style.optString("fontStyle") == "italic"
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Typeface.create(family, weight, italic)
        } else {
            Typeface.create(family, (if (weight >= 600) Typeface.BOLD else 0) or (if (italic) Typeface.ITALIC else 0))
        }
    }

    /** Inline runs: strings, and nested `Text` runs such as links and `<strong>`. */
    private fun runs(children: JSONArray, out: SpannableStringBuilder, transform: String) {
        for (index in 0 until children.length()) {
            val child = children.get(index)
            if (child is String) {
                out.append(
                    when (transform) {
                        "uppercase" -> child.uppercase()
                        "lowercase" -> child.lowercase()
                        "capitalize" -> child.split(" ").joinToString(" ") { word -> word.replaceFirstChar(Char::titlecase) }
                        else -> child
                    },
                )
                continue
            }
            val run = child as JSONObject
            val style = style(run)
            val start = out.length
            runs(run.optJSONArray("children") ?: JSONArray(), out, style.optString("textTransform").ifEmpty { transform })
            val end = out.length
            if (end == start) continue
            fun span(what: Any) = out.setSpan(what, start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            color(style.optString("color").ifEmpty { null })?.let { span(ForegroundColorSpan(it)) }
            if (style.has("fontSize")) span(AbsoluteSizeSpan(style.optDouble("fontSize").roundToInt(), true))
            val weight = style.optInt("fontWeight", 0)
            val italic = style.optString("fontStyle") == "italic"
            if (weight >= 600 || italic) {
                span(StyleSpan((if (weight >= 600) Typeface.BOLD else 0) or (if (italic) Typeface.ITALIC else 0)))
            }
            if (style.optString("fontFamily") == "mono") span(TypefaceSpan("monospace"))
            when (style.optString("textDecorationLine")) {
                "underline" -> span(UnderlineSpan())
                "line-through" -> span(StrikethroughSpan())
            }
            run.optString("href").takeIf { it.isNotEmpty() }?.let { href ->
                span(object : ClickableSpan() {
                    override fun onClick(widget: View) = host.visit(Uri.parse(href), replace = false)
                    override fun updateDrawState(paint: TextPaint) {
                        // Links look as the page styles them, not as Android's default blue.
                        paint.isUnderlineText = style.optString("textDecorationLine") == "underline"
                    }
                })
            }
        }
    }
}

/** A linear layout that honors `max-width` and `max-height`. */
private class BoxLayout(context: Context) : LinearLayout(context) {
    var maxWidth: Int? = null
    var maxHeight: Int? = null

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        fun clamp(spec: Int, max: Int?): Int {
            if (max == null) return spec
            val size = MeasureSpec.getSize(spec)
            return when (MeasureSpec.getMode(spec)) {
                MeasureSpec.UNSPECIFIED -> MeasureSpec.makeMeasureSpec(max, MeasureSpec.AT_MOST)
                else -> MeasureSpec.makeMeasureSpec(minOf(size, max), MeasureSpec.getMode(spec))
            }
        }
        super.onMeasure(clamp(widthMeasureSpec, maxWidth), clamp(heightMeasureSpec, maxHeight))
    }
}

/** Children laid out in rows that wrap, as a wrapping flex row does. */
private class FlowLayout(
    context: Context,
    private val columnGap: Int,
    private val rowGap: Int,
    private val centerItems: Boolean,
) : ViewGroup(context) {
    override fun checkLayoutParams(params: LayoutParams?) = params is MarginLayoutParams
    override fun generateLayoutParams(params: LayoutParams?) = MarginLayoutParams(params)
    override fun generateDefaultLayoutParams() = MarginLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)

    /** Each line: its children's indexes and its height. */
    private var lines: List<Pair<List<Int>, Int>> = emptyList()

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val available = if (MeasureSpec.getMode(widthMeasureSpec) == MeasureSpec.UNSPECIFIED) {
            Int.MAX_VALUE
        } else {
            MeasureSpec.getSize(widthMeasureSpec) - paddingLeft - paddingRight
        }
        val built = mutableListOf<Pair<List<Int>, Int>>()
        var current = mutableListOf<Int>()
        var x = 0
        var lineHeight = 0
        var widest = 0
        for (index in 0 until childCount) {
            val child = getChildAt(index)
            if (child.visibility == GONE) continue
            measureChildWithMargins(child, widthMeasureSpec, 0, heightMeasureSpec, 0)
            val params = child.layoutParams as MarginLayoutParams
            val width = child.measuredWidth + params.leftMargin + params.rightMargin
            val height = child.measuredHeight + params.topMargin + params.bottomMargin
            if (current.isNotEmpty() && x + columnGap + width > available) {
                built += current to lineHeight
                current = mutableListOf()
                x = 0
                lineHeight = 0
            }
            if (current.isNotEmpty()) x += columnGap
            current += index
            x += width
            lineHeight = maxOf(lineHeight, height)
            widest = maxOf(widest, x)
        }
        if (current.isNotEmpty()) built += current to lineHeight
        lines = built
        val height = built.sumOf { it.second } + rowGap * maxOf(0, built.size - 1)
        setMeasuredDimension(
            resolveSize(widest + paddingLeft + paddingRight, widthMeasureSpec),
            resolveSize(height + paddingTop + paddingBottom, heightMeasureSpec),
        )
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        var y = paddingTop
        for ((indexes, lineHeight) in lines) {
            var x = paddingLeft
            for (index in indexes) {
                val child = getChildAt(index)
                val params = child.layoutParams as MarginLayoutParams
                val offset = if (centerItems) (lineHeight - child.measuredHeight - params.topMargin - params.bottomMargin) / 2 else 0
                val childLeft = x + params.leftMargin
                val childTop = y + params.topMargin + offset
                child.layout(childLeft, childTop, childLeft + child.measuredWidth, childTop + child.measuredHeight)
                x = childLeft + child.measuredWidth + params.rightMargin + columnGap
            }
            y += lineHeight + rowGap
        }
    }
}
