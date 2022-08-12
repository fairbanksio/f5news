package de.jensklingenberg.jetpackcomposeplayground.mysamples.github.material.dropdown

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Share
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp

@Composable
fun SubredditDropdown(
    items: List<String>,
    selected: String,
    onSubredditSelect: (String) -> Any
) {

    var expanded by remember { mutableStateOf(false) }
    val SelectedValue = selected
    var selectedIndex by remember { mutableStateOf(0) }

    Box(modifier = Modifier
        .wrapContentSize(Alignment.TopStart)
    ) {

        TextButton(
            onClick = { expanded = true },
            colors = ButtonDefaults.textButtonColors(
                contentColor = Color.White
            )
        ) {

            Text(text="r/" + items[selectedIndex])

            Icon(
                imageVector = Icons.Filled.ArrowDropDown,
                contentDescription = "Localized description",
                Modifier.padding(end = 8.dp)
            )
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier
                .background(Color.LightGray)

        ) {
            items.forEachIndexed { index, s ->
                DropdownMenuItem(onClick = {
                    onSubredditSelect(s)
                    selectedIndex = index
                    expanded = false
                }) {
                   if (s == SelectedValue) {
                       Text(text = s, fontWeight = FontWeight.Bold)
                    } else {
                       Text(text = s )
                    }

                }
            }
        }
    }
}